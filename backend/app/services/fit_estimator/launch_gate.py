"""Wire the fit estimator into LLMHub's vec-inf launch path.

LLMHub assigns GPUs from the per-model catalog entry in ``models.yaml``; users
only override partition and job time at launch. This module resolves that
catalog + infrastructure defaults into the tuple the validator expects, then
certifies the config using the **effective** launch concurrency from
:func:`~app.services.fit_estimator.concurrency.resolve_max_num_seqs` (same
value the vLLM command will use). Worst-case KV is
``max_model_len × effective_max_num_seqs``.

If the target partition is absent from the bundled Delta hardware table the gate
is skipped (returns ``None``) so non-Delta infrastructures are unaffected.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Mapping, Optional

from app.config.logging import get_logger
from app.utils.infrastructure import InfrastructureManager

from .concurrency import catalog_max_num_seqs, resolve_max_num_seqs
from .hardware import load_partitions
from .validator import ConfigValidation, _empty_breakdown, validate_config_for_model
from app.utils.huggingface import resolve_hf_model_id

logger = get_logger("fit_estimator.launch_gate")

_PARTITION_GPU_CAP_RE = re.compile(r"x(\d+)(?:-|$)")


def max_gpus_for_partition(partition: str) -> int:
    """Max tensor-parallel size for a Delta partition (GPUs per node)."""
    match = _PARTITION_GPU_CAP_RE.search(partition)
    return int(match.group(1)) if match else 4


@dataclass(frozen=True)
class CatalogLaunchSpec:
    """Resolved launch tuple for the memory gate."""

    model_name: str
    hf_model_id: str
    partition: str
    max_model_len: int
    tensor_parallel_size: int
    num_nodes: int


def _model_config_to_dict(model_config: Any) -> dict[str, Any]:
    if isinstance(model_config, dict):
        return model_config
    if hasattr(model_config, "__dict__"):
        return dict(model_config.__dict__)
    return {}


def _vllm_arg_int(vllm_args: Any, flag: str) -> int | None:
    """Read a numeric vLLM CLI flag from catalog ``vllm_args`` (dict or string)."""
    if isinstance(vllm_args, dict):
        raw = vllm_args.get(flag)
        if raw is not None:
            return int(raw)
        return None

    if isinstance(vllm_args, str) and flag in vllm_args:
        tail = vllm_args.split(flag, 1)[1].strip()
        if tail.startswith("="):
            tail = tail[1:].strip()
        try:
            return int(tail.split()[0])
        except (ValueError, IndexError):
            return None

    return None


def _extract_max_model_len(model_dict: Mapping[str, Any]) -> int:
    vllm_args = model_dict.get("vllm_args")
    parsed = _vllm_arg_int(vllm_args, "--max-model-len")
    if parsed is not None:
        return parsed
    direct = model_dict.get("max_model_len")
    if direct is not None:
        return int(direct)
    return 4096


def _extract_tensor_parallel_size(model_dict: Mapping[str, Any]) -> int:
    vllm_args = model_dict.get("vllm_args")
    parsed = _vllm_arg_int(vllm_args, "--tensor-parallel-size")
    if parsed is not None:
        return max(1, parsed)
    gpus = model_dict.get("gpus_per_node") or model_dict.get("num_gpus") or 1
    return max(1, int(gpus))


def _default_partition() -> str | None:
    mgr = InfrastructureManager()
    default_args = (mgr.get_environment_config() or {}).get("default_args") or {}
    partition = default_args.get("partition")
    return str(partition) if partition else None


def partition_supported(partition: str) -> bool:
    """True when ``partition`` exists in the bundled hardware table."""
    return any(p.partition == partition for p in load_partitions())


def resolve_catalog_launch_spec(
    model_name: str,
    model_config: Mapping[str, Any],
    *,
    hf_model: str | None = None,
    partition: str | None = None,
    max_model_len: int | None = None,
    tensor_parallel_size: int | None = None,
    num_nodes: int | None = None,
    max_num_seqs: int | None = None,
) -> CatalogLaunchSpec | None:
    """Build the launch tuple from a vec-inf catalog entry + API overrides."""
    resolved_partition = partition or _default_partition()
    if not resolved_partition:
        logger.warning(
            "Skipping launch memory gate for %s: no partition in request or "
            "infrastructure defaults",
            model_name,
        )
        return None

    if not partition_supported(resolved_partition):
        logger.info(
            "Skipping launch memory gate for %s on %s (partition not in hardware "
            "table)",
            model_name,
            resolved_partition,
        )
        return None

    resolved_hf = resolve_hf_model_id(
        model_name,
        family=str(model_config.get("model_family") or ""),
        huggingface_id=hf_model or model_config.get("huggingface_id"),
    )
    resolved_max_len = max_model_len or _extract_max_model_len(model_config)
    resolved_tp = tensor_parallel_size or _extract_tensor_parallel_size(model_config)
    resolved_nodes = num_nodes
    if resolved_nodes is None:
        resolved_nodes = int(model_config.get("num_nodes") or 1)

    return CatalogLaunchSpec(
        model_name=model_name,
        hf_model_id=str(resolved_hf),
        partition=resolved_partition,
        max_model_len=int(resolved_max_len),
        tensor_parallel_size=int(resolved_tp),
        num_nodes=int(resolved_nodes),
    )


def check_launch_memory_gate(
    model_name: str,
    model_config: Mapping[str, Any],
    *,
    hf_model: str | None = None,
    partition: str | None = None,
    max_model_len: int | None = None,
    tensor_parallel_size: int | None = None,
    num_nodes: int | None = None,
    max_num_seqs: int | None = None,
) -> ConfigValidation | None:
    """Certify a catalog launch config before vec-inf submits Slurm.

    Returns ``None`` when the gate is skipped (unsupported partition). Otherwise
    returns a :class:`ConfigValidation` verdict using the launch contract.
    """
    spec = resolve_catalog_launch_spec(
        model_name,
        model_config,
        hf_model=hf_model,
        partition=partition,
        max_model_len=max_model_len,
        tensor_parallel_size=tensor_parallel_size,
        num_nodes=num_nodes,
        max_num_seqs=max_num_seqs,
    )
    if spec is None:
        return None

    effective_seqs = resolve_max_num_seqs(
        ui_override=max_num_seqs,
        catalog_value=catalog_max_num_seqs(model_config),
    )

    partition_cap = max_gpus_for_partition(spec.partition)
    if spec.tensor_parallel_size > partition_cap:
        return ConfigValidation(
            valid=False,
            reason=(
                f"tensor_parallel_size ({spec.tensor_parallel_size}) exceeds "
                f"{spec.partition} capacity ({partition_cap} GPUs per node)."
            ),
            per_gpu_breakdown=_empty_breakdown(),
        )

    logger.info(
        "Launch memory gate: model=%s hf=%s partition=%s max_model_len=%s "
        "tp=%s nodes=%s effective_max_num_seqs=%s (ui_override=%s catalog=%s)",
        spec.model_name,
        spec.hf_model_id,
        spec.partition,
        spec.max_model_len,
        spec.tensor_parallel_size,
        spec.num_nodes,
        effective_seqs,
        max_num_seqs,
        catalog_max_num_seqs(model_config),
    )

    return validate_config_for_model(
        spec.hf_model_id,
        max_model_len=spec.max_model_len,
        tensor_parallel_size=spec.tensor_parallel_size,
        partition=spec.partition,
        num_nodes=spec.num_nodes,
        max_num_seqs=effective_seqs,
    )


def check_launch_memory_gate_for_model(
    model_name: str,
    get_model_details: Any,
    **launch_overrides: Any,
) -> ConfigValidation | None:
    """Resolve catalog config via vec-inf, then run :func:`check_launch_memory_gate`."""
    details_result = get_model_details(model_name)
    if not details_result.get("success"):
        return ConfigValidation(
            valid=False,
            reason=(
                f"cannot verify {model_name!r}: failed to load catalog config "
                f"({details_result.get('error', 'unknown error')})."
            ),
            per_gpu_breakdown=_empty_breakdown(),
        )

    model_config = _model_config_to_dict(details_result.get("details") or {})
    return check_launch_memory_gate(
        model_name,
        model_config,
        hf_model=launch_overrides.get("hf_model"),
        partition=launch_overrides.get("partition"),
        max_model_len=launch_overrides.get("max_model_len"),
        tensor_parallel_size=launch_overrides.get("tensor_parallel_size"),
        num_nodes=launch_overrides.get("num_nodes"),
        max_num_seqs=launch_overrides.get("max_num_seqs"),
    )
