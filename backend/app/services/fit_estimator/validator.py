"""Pre-launch config validation gate (worst-case, tensor-parallel aware).

This is a GATE, not a recommender: the user supplies a concrete config
(model, context window, tensor_parallel_size, num_nodes, partition) and we
CERTIFY whether it can run without OOM at the declared limits, before any
resources are touched. It answers one question -- "can this config OOM at
context = max_model_len with the default max_num_seqs?" -- and rejects
immediately with a specific reason if so.

Safety posture (this gate blocks real jobs)
-------------------------------------------
Every uncalibrated constant biases toward FALSE-REJECT, never false-accept:

* false accept -> the user's job OOMs at/after launch. This is the exact failure
  the gate exists to prevent, and it wastes real cluster resources.
* false reject -> user annoyance (a config we could not certify is refused).
  Acceptable at launch time and tightened later by the calibration sweep.

Consequences of that posture, enforced here:

* Validation is WORST-CASE only: full ``max_model_len`` x the vLLM default
  ``max_num_seqs``. The typical/archetype machinery still lives in the package
  but is intentionally NOT used in this path.
* If model metadata cannot be resolved, or required config fields are missing,
  we return ``valid=False`` with reason "cannot verify ..." -- never
  pass-by-default.
* Uneven tensor-parallel sharding rounds toward MORE per-GPU memory.

Out of scope on this branch: ``min_sufficient_config`` (seam only, stays null),
multi-node math (explicit reject), cost ranking, the typical/archetype path.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional, Sequence

from .constants import DEFAULT_GPU_MEMORY_UTILIZATION, DEFAULT_MAX_NUM_SEQS
from .hardware import GpuPartition, load_partitions
from .memory_model import (
    evaluate_fit,
    heads_shard_evenly,
    kv_heads_replicated,
    kv_pool_required_gib,
    per_token_kv_bytes_per_gpu,
    weights_per_gpu_gib,
)
from .model_metadata import ModelMetadata
from .overhead import total_overhead_per_gpu_gib


@dataclass(frozen=True)
class PerGpuBreakdown:
    """Per-GPU memory picture. Fields are None when the gate cannot compute."""

    weights_gib: Optional[float]
    kv_pool_required_gib: Optional[float]
    overhead_gib: Optional[float]
    total_gib: Optional[float]
    vram_gib: Optional[float]
    headroom_gib: Optional[float]


def _empty_breakdown(vram_gib: Optional[float] = None) -> PerGpuBreakdown:
    return PerGpuBreakdown(None, None, None, None, vram_gib, None)


@dataclass(frozen=True)
class ConfigValidation:
    """Verdict from :func:`validate_config`."""

    valid: bool
    reason: str
    per_gpu_breakdown: PerGpuBreakdown
    warnings: list[str] = field(default_factory=list)
    # Seam: whether the gate should suggest a fix is an open product decision.
    # Build the field, do not populate it on this branch.
    min_sufficient_config: Optional[Any] = None
    # Seam: lets the pipeline run the gate in warn-not-block mode during rollout.
    # Left None (absent) by default; the pipeline sets it, not the estimator.
    advisory_only: Optional[bool] = None


def _find_partition(
    name: str, partitions: Sequence[GpuPartition]
) -> GpuPartition | None:
    for p in partitions:
        if p.partition == name:
            return p
    return None


def _short_gpu(gpu_type: str) -> str:
    return gpu_type.replace("NVIDIA ", "").strip() or gpu_type


def _collect_warnings(meta: ModelMetadata, tp_size: int) -> list[str]:
    warnings: list[str] = []
    if tp_size <= 1:
        return warnings

    if kv_heads_replicated(meta.n_kv_heads, tp_size):
        warnings.append(
            f"num_key_value_heads ({meta.n_kv_heads}) < tensor_parallel_size "
            f"({tp_size}): vLLM replicates KV heads across ranks, so per-GPU KV "
            f"cache cannot shrink below one head per rank (sized conservatively)."
        )
    elif meta.n_kv_heads % tp_size != 0:
        warnings.append(
            f"num_key_value_heads ({meta.n_kv_heads}) is not divisible by "
            f"tensor_parallel_size ({tp_size}); vLLM may reject this config or "
            f"pad heads. Per-GPU memory estimated conservatively."
        )

    if meta.n_attention_heads % tp_size != 0:
        warnings.append(
            f"num_attention_heads ({meta.n_attention_heads}) is not divisible by "
            f"tensor_parallel_size ({tp_size}); expect per-rank imbalance. "
            f"Per-GPU memory estimated conservatively."
        )
    return warnings


def validate_config(
    meta: ModelMetadata,
    *,
    max_model_len: int,
    tensor_parallel_size: int,
    partition: str,
    num_nodes: int = 1,
    partitions: Sequence[GpuPartition] | None = None,
    max_num_seqs: int = DEFAULT_MAX_NUM_SEQS,
) -> ConfigValidation:
    """Certify a concrete launch config against a partition.

    ``max_num_seqs`` controls the KV token budget:

    * ``resolve_max_num_seqs()`` — effective launch concurrency (gate + UI).
    * ``LAUNCH_GATE_MAX_NUM_SEQS`` (1) — legacy boot-only contract; deprecated.
    * ``DEFAULT_MAX_NUM_SEQS`` (256) — vLLM default when catalog omits the flag.
    """
    parts = tuple(partitions) if partitions is not None else load_partitions()

    if tensor_parallel_size < 1:
        return ConfigValidation(
            valid=False,
            reason=f"tensor_parallel_size must be >= 1 (got {tensor_parallel_size}).",
            per_gpu_breakdown=_empty_breakdown(),
        )

    gpu = _find_partition(partition, parts)
    if gpu is None:
        known = ", ".join(p.partition for p in parts)
        return ConfigValidation(
            valid=False,
            reason=f"Unknown partition {partition!r}. Known partitions: {known}.",
            per_gpu_breakdown=_empty_breakdown(),
        )

    if not gpu.is_nvidia:
        return ConfigValidation(
            valid=False,
            reason=(
                f"Partition {partition} is {gpu.gpu_type} (non-NVIDIA); this gate "
                f"only validates NVIDIA/vLLM configs."
            ),
            per_gpu_breakdown=_empty_breakdown(gpu.vram_gib_per_gpu),
        )

    # Explicit non-support beats a wrong answer: multi-node splitting (PP vs TP
    # across nodes) is ambiguous and not modeled on this branch.
    if num_nodes > 1:
        return ConfigValidation(
            valid=False,
            reason=(
                f"multi-node validation not yet supported (num_nodes={num_nodes}); "
                f"only single-node tensor parallelism is validated on this branch."
            ),
            per_gpu_breakdown=_empty_breakdown(gpu.vram_gib_per_gpu),
        )

    # Never pass by default: unresolved metadata -> "cannot verify".
    missing: list[str] = []
    if meta.weights_bytes is None:
        missing.append("weights size")
    if not meta.kv_fields_known:
        missing.append(
            "KV config fields (" + ", ".join(meta.unknown_fields) + ")"
        )
    if missing:
        return ConfigValidation(
            valid=False,
            reason=(
                f"cannot verify {meta.source_model!r}: unresolved "
                + "; ".join(missing)
                + ". Refusing to certify a config we cannot size."
            ),
            per_gpu_breakdown=_empty_breakdown(gpu.vram_gib_per_gpu),
        )

    tp = tensor_parallel_size
    weights_gib = weights_per_gpu_gib(meta.weights_bytes, tp)
    per_token_gpu = per_token_kv_bytes_per_gpu(
        meta.n_layers, meta.n_kv_heads, meta.head_dim, meta.kv_dtype_bytes, tp
    )
    # Worst case: every one of max_num_seqs sequences fills the full context.
    worst_case_tokens = max_model_len * max_num_seqs
    kv_gib = kv_pool_required_gib(per_token_gpu, worst_case_tokens)

    overhead_gib = total_overhead_per_gpu_gib(
        gpu.vram_gib_per_gpu,
        DEFAULT_GPU_MEMORY_UTILIZATION,
        gpu.framework_overhead_gib,
        gpu.tp_communication_buffer_gib,
        tp,
        {
            "num_hidden_layers": meta.n_layers,
            "hidden_size": meta.hidden_size,
            "num_attention_heads": meta.n_attention_heads,
        },
        max_num_seqs,
    )

    vram = gpu.vram_gib_per_gpu
    fit = evaluate_fit(weights_gib, kv_gib, overhead_gib, vram)
    breakdown = PerGpuBreakdown(
        weights_gib=weights_gib,
        kv_pool_required_gib=kv_gib,
        overhead_gib=overhead_gib,
        total_gib=fit.total_gib,
        vram_gib=vram,
        headroom_gib=fit.headroom_gib,
    )
    warnings = _collect_warnings(meta, tp)

    # " at TP=N" reads naturally after "per GPU"; " (TP=N)" after a noun.
    tp_suffix = f" at TP={tp}" if tp > 1 else ""
    tp_paren = f" (TP={tp})" if tp > 1 else ""
    short = _short_gpu(gpu.gpu_type)

    if fit.fits:
        reason = (
            f"Config valid: {fit.total_gib:.1f} GiB/GPU of {vram:.0f} GiB on "
            f"{short}{tp_paren} at context {max_model_len} "
            f"(weights {weights_gib:.1f} + KV {kv_gib:.1f} + overhead "
            f"{overhead_gib:.1f}), {fit.headroom_gib:.1f} GiB headroom."
        )
        return ConfigValidation(True, reason, breakdown, warnings)

    if weights_gib + overhead_gib >= vram:
        reason = (
            f"Model weights alone ({weights_gib:.1f} GiB per GPU{tp_suffix}) "
            f"exceed {short} VRAM ({vram:.0f} GiB) after overhead "
            f"({overhead_gib:.1f} GiB); insufficient room for KV cache at "
            f"context {max_model_len}."
        )
    else:
        reason = (
            f"Config exceeds {short} VRAM ({vram:.0f} GiB){tp_paren} at context "
            f"{max_model_len}: weights {weights_gib:.1f} + KV {kv_gib:.1f} + "
            f"overhead {overhead_gib:.1f} = {fit.total_gib:.1f} GiB/GPU "
            f"(over by {-fit.headroom_gib:.1f} GiB). Reduce context, raise "
            f"tensor_parallel_size, or choose a larger-VRAM partition."
        )
    return ConfigValidation(False, reason, breakdown, warnings)


def validate_config_for_model(
    model_id: str,
    *,
    max_model_len: int,
    tensor_parallel_size: int,
    partition: str,
    num_nodes: int = 1,
    max_num_seqs: int = DEFAULT_MAX_NUM_SEQS,
    dtype: str | None = None,
    revision: str = "main",
) -> ConfigValidation:
    """Network-backed wrapper: resolve ``model_id`` then validate the config.

    A metadata fetch failure is turned into a "cannot verify" verdict rather
    than an exception, so the gate never passes by default on network errors.
    """
    from .model_metadata import fetch_model_metadata

    try:
        meta = fetch_model_metadata(model_id, dtype=dtype, revision=revision)
    except Exception as exc:  # network / missing config / parse failure
        return ConfigValidation(
            valid=False,
            reason=(
                f"cannot verify {model_id!r}: failed to resolve model metadata "
                f"({exc}). Refusing to certify a config we cannot size."
            ),
            per_gpu_breakdown=_empty_breakdown(),
        )

    return validate_config(
        meta,
        max_model_len=max_model_len,
        tensor_parallel_size=tensor_parallel_size,
        partition=partition,
        num_nodes=num_nodes,
        max_num_seqs=max_num_seqs,
    )
