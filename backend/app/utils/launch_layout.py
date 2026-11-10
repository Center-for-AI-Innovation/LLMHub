"""The parallel layout a launch runs with, and the shapes LLMHub refuses (#175).

A request that leaves ``num_gpus`` and ``num_nodes`` unset (the UI) runs the
catalog entry's own layout, unchanged. A request that sets either gets:

- the catalog entry's own TP/PP flags, when its GPUs per node and node count
  match the entry's (#112: an explicit request used to replace them);
- otherwise TP = GPUs per node and PP = nodes.

That request is then checked against the partition it will run on, before any
weights are fetched or any launcher is built. These shapes are refused, with
the reason:

- ``num_nodes`` over the partition's MaxNodes;
- more GPUs per node than the partition's nodes have, so TP would exceed them;
- TP across nodes, which no runnable catalog entry needs;
- multinode on an engine other than vLLM: vec-inf starts SGLang's nodes as one
  ``srun`` step each, and DeltaAI's per-step VNI keeps them apart;
- multinode on a vec-inf the multinode adapter was not tested against.

The partition's limits are read from Slurm (``sinfo``) when the request is
checked. If Slurm does not answer, those two checks are skipped and Slurm's own
submit-time limits still apply.
"""

import re
import subprocess
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from app.config.logging import get_logger

logger = get_logger("launch_layout")

TP_FLAG = "--tensor-parallel-size"
PP_FLAG = "--pipeline-parallel-size"
# The GPU count in a node's GRES, e.g. ``gpu:nvidia_gh200_120gb:4(S:0-3)``.
_GPU_GRES_RE = re.compile(r"(?:^|,)gpu(?::[^:,(]+)?:(\d+)")


class LaunchRefused(ValueError):
    """A launch shape the cluster can't run; the message is the reason."""


@dataclass(frozen=True)
class Layout:
    gpus_per_node: int
    num_nodes: int
    tensor_parallel: int
    pipeline_parallel: int
    # True when the catalog entry's own TP/PP flags stand.
    from_catalog: bool

    def flags(self) -> List[str]:
        """The engine flags the launch adds; none when the catalog's stand."""
        if self.from_catalog:
            return []
        return [
            f"{TP_FLAG}={self.tensor_parallel}",
            f"{PP_FLAG}={self.pipeline_parallel}",
        ]


def _engine(config: Any) -> str:
    return getattr(config, "engine", None) or "vllm"


def _size(engine_args: Optional[Dict[str, Any]], flag: str) -> int:
    return int((engine_args or {}).get(flag, 1))


def requests_layout(params: Dict[str, Any]) -> bool:
    """True when the request sets its own GPU or node count."""
    return params.get("num_gpus") is not None or params.get("num_nodes") is not None


def resolve_layout(config: Any, params: Dict[str, Any]) -> Layout:
    """The layout a request runs with, given its catalog entry (vec-inf ModelConfig)."""
    catalog = (int(config.gpus_per_node), int(config.num_nodes))
    gpus = catalog[0] if params.get("num_gpus") is None else int(params["num_gpus"])
    nodes = catalog[1] if params.get("num_nodes") is None else int(params["num_nodes"])
    if (gpus, nodes) == catalog:
        args = getattr(config, f"{_engine(config)}_args", None)
        return Layout(gpus, nodes, _size(args, TP_FLAG), _size(args, PP_FLAG), True)
    return Layout(gpus, nodes, gpus, nodes, False)


def _sinfo(partition: str) -> Optional[str]:
    try:
        proc = subprocess.run(
            ["sinfo", "--noheader", "--partition", partition, "--format", "%s|%G"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warning("sinfo for partition %s failed: %s", partition, exc)
        return None
    if proc.returncode != 0:
        logger.warning(
            "sinfo for partition %s exited %s: %s",
            partition,
            proc.returncode,
            proc.stderr.strip(),
        )
        return None
    return proc.stdout


def partition_limits(partition: str) -> Tuple[Optional[int], Optional[int]]:
    """``(MaxNodes, GPUs per node)`` of a partition, each None when unknown.

    MaxNodes (``%s``, the same on every line) is None for an unlimited
    partition. A partition whose node groups differ reports its largest GPU count.
    """
    out = _sinfo(partition)
    lines = [line.strip() for line in (out or "").splitlines() if line.strip()]
    if not lines:
        logger.warning("No sinfo answer for partition %s; limits unchecked", partition)
        return None, None
    upper = lines[0].partition("|")[0].rpartition("-")[2]
    gres = [line.partition("|")[2] for line in lines]
    gpus = [int(n) for g in gres for n in _GPU_GRES_RE.findall(g)]
    return (int(upper) if upper.isdigit() else None), (max(gpus) if gpus else None)


def check_layout(config: Any, layout: Layout, partition: Optional[str]) -> None:
    """Raise ``LaunchRefused`` for a shape the partition can't run."""
    if layout.num_nodes > 1:
        engine = _engine(config)
        if engine != "vllm":
            raise LaunchRefused(
                f"multinode launches run on vLLM only; {config.model_name} uses "
                f"{engine}, whose nodes vec-inf starts as separate srun steps that "
                "cannot reach each other over the fabric"
            )
        # Imported here: vec-inf reads its config on import, which
        # app.utils.llm_inference must set up first.
        from app.utils import vec_inf_multinode

        try:
            vec_inf_multinode.check_vec_inf_version()
        except vec_inf_multinode.MultinodeLaunchError as exc:
            raise LaunchRefused(str(exc)) from exc
        if layout.tensor_parallel > layout.gpus_per_node:
            raise LaunchRefused(
                f"tensor parallel {layout.tensor_parallel} would span nodes of "
                f"{layout.gpus_per_node} GPUs each; LLMHub runs tensor parallel "
                "within a node and pipeline parallel across nodes"
            )
    if not partition:
        return
    max_nodes, node_gpus = partition_limits(partition)
    if max_nodes is not None and layout.num_nodes > max_nodes:
        raise LaunchRefused(
            f"{layout.num_nodes} nodes requested; partition {partition} allows at "
            f"most {max_nodes} per job"
        )
    if node_gpus is not None and layout.gpus_per_node > node_gpus:
        raise LaunchRefused(
            f"{layout.gpus_per_node} GPUs per node requested (tensor parallel "
            f"{layout.tensor_parallel}); partition {partition} has {node_gpus} "
            "per node"
        )
