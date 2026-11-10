"""The parallel layout a launch runs with, and the shapes LLMHub refuses (#175).

A request that leaves ``num_gpus`` and ``num_nodes`` unset (the UI) runs the
catalog entry's own layout, unchanged. A request that sets either gets:

- the catalog entry's own TP/PP flags, when its GPUs per node and node count
  match the entry's (#112: an explicit request used to replace them);
- otherwise TP = GPUs per node and PP = nodes.

That request is then checked against the partition it will run on, before any
weights are fetched or any launcher is built. These shapes are refused, with
the reason:

- ``num_nodes`` outside the partition's MinNodes-MaxNodes;
- more GPUs per node than the partition's nodes have, so TP would exceed them;
- a partition Slurm doesn't list;
- TP across nodes, which no runnable catalog entry needs;
- multinode on an engine other than vLLM: vec-inf starts SGLang's nodes as one
  ``srun`` step each, and DeltaAI's per-step VNI keeps them apart;
- multinode on a vec-inf the multinode adapter was not tested against.

Shapes vec-inf itself refuses (counts below 1, a GPU total that is not a power
of two, TP x PP not the GPU total) are refused here too, before any download.

The partition's limits are read from Slurm (``sinfo``) when the request is
checked. Of a comma-separated list, every partition must be one Slurm lists and
fit its node limits, as Slurm requires (DeltaAI: EnforcePartLimits=ALL), and
one must have the GPUs per node. If Slurm does not answer, these partition
checks are skipped and Slurm's own submit-time limits apply.
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


def _sinfo() -> Optional[str]:
    """``partition|MinNodes-MaxNodes|GRES`` per node group, for every partition.

    ``--all`` includes hidden partitions and ones closed to this account: the
    job is submitted as another user, who may see more than the backend does.
    """
    try:
        proc = subprocess.run(
            ["sinfo", "--all", "--noheader", "--format", "%P|%s|%G"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warning("sinfo failed: %s", exc)
        return None
    if proc.returncode != 0:
        logger.warning("sinfo exited %s: %s", proc.returncode, proc.stderr.strip())
        return None
    return proc.stdout


def partition_limits() -> Optional[Dict[str, Tuple[int, Optional[int], Optional[int]]]]:
    """``{partition: (MinNodes, MaxNodes, GPUs per node)}`` from ``sinfo``.

    ``%s`` is ``min-max``, or one number when they are equal; MaxNodes is None
    for an unlimited partition. Rows of one partition are combined to the
    tightest node limits and the largest GPU count (None without GPUs). None
    when ``sinfo`` fails.
    """
    out = _sinfo()
    if out is None:
        return None
    limits: Dict[str, Tuple[int, Optional[int], Optional[int]]] = {}
    for line in out.splitlines():
        name, _, rest = line.strip().partition("|")
        if not name:
            continue
        name = name.rstrip("*")  # the default partition
        size, _, gres = rest.partition("|")
        lower, dash, upper = size.partition("-")
        low = int(lower) if lower.isdigit() else 1
        bound = upper if dash else lower  # "N": MinNodes equals MaxNodes
        high = int(bound) if bound.isdigit() else None
        gpus = [int(n) for n in _GPU_GRES_RE.findall(gres)]
        if name in limits:
            known_low, known_high, known_gpus = limits[name]
            low = max(low, known_low)
            high = known_high if high is None else min(high, known_high or high)
            gpus += [] if known_gpus is None else [known_gpus]
        limits[name] = (low, high, max(gpus, default=None))
    return limits


def _check_partition(layout: Layout, partition: str) -> None:
    """Refuse a partition, or a comma-separated list, the request can't run on.

    Node limits must hold on every partition listed, because Slurm checks a
    job's partition limits against each one (DeltaAI: ``EnforcePartLimits=ALL``)
    and rejects it at submit otherwise. GPUs per node need one listed partition
    that has them: the job runs on whichever partition can place it.
    """
    names = list(dict.fromkeys(name for name in partition.split(",") if name))
    if not names:
        raise LaunchRefused(f"partition {partition!r} names no partition")
    limits = partition_limits()
    if limits is None:
        logger.warning("Partition %s limits unchecked: no sinfo answer", partition)
        return
    reasons = []
    short_of_gpus = []
    for name in names:
        if name not in limits:
            reasons.append(f"partition {name} is not a partition Slurm lists")
            continue
        min_nodes, max_nodes, node_gpus = limits[name]
        if layout.num_nodes < min_nodes:
            reasons.append(
                f"{layout.num_nodes} nodes requested; partition {name} needs at "
                f"least {min_nodes} per job"
            )
        if max_nodes is not None and layout.num_nodes > max_nodes:
            reasons.append(
                f"{layout.num_nodes} nodes requested; partition {name} allows at "
                f"most {max_nodes} per job"
            )
        if node_gpus is not None and layout.gpus_per_node > node_gpus:
            short_of_gpus.append(f"partition {name} has {node_gpus} per node")
    if short_of_gpus and len(short_of_gpus) == len(names):
        reasons.append(
            f"{layout.gpus_per_node} GPUs per node requested (tensor parallel "
            f"{layout.tensor_parallel}); " + ", ".join(short_of_gpus)
        )
    if reasons:
        raise LaunchRefused("; ".join(reasons))


def check_layout(config: Any, layout: Layout, partition: Optional[str]) -> None:
    """Raise ``LaunchRefused`` for a shape the partition can't run."""
    total = layout.gpus_per_node * layout.num_nodes
    if layout.gpus_per_node < 1 or layout.num_nodes < 1:
        raise LaunchRefused("num_gpus and num_nodes must each be at least 1")
    # vec-inf's own rules (_validate_resource_allocation), checked here so the
    # request is refused before any download, not by vec-inf after it.
    if total & (total - 1):
        raise LaunchRefused(
            f"{total} GPUs in all ({layout.gpus_per_node} per node on "
            f"{layout.num_nodes} nodes); vec-inf launches a power of two"
        )
    if layout.tensor_parallel * layout.pipeline_parallel != total:
        raise LaunchRefused(
            f"tensor parallel {layout.tensor_parallel} x pipeline parallel "
            f"{layout.pipeline_parallel} does not match the {total} GPUs requested"
        )
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
    if partition:
        _check_partition(layout, partition)
