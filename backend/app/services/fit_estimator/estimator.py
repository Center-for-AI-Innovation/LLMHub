"""Orchestrate a per-partition GPU fit estimate from resolved model metadata.

Pure with respect to the network: it takes an already-resolved
:class:`~app.services.fit_estimator.model_metadata.ModelMetadata` plus the job
knobs and returns structured results. The HTTP boundary lives in the controller
/ :func:`estimate_fit_for_model`, so the interesting logic here is importable
and testable without any I/O.

For every partition the estimator computes BOTH KV assumptions (worst_case and
typical) and flags the requested one as primary -- this is deliberate and must
not be collapsed to a single number.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Mapping, Sequence

from .capacity import KvCapacity, kv_pool_capacity
from .constants import (
    DEFAULT_GPU_MEMORY_UTILIZATION,
    DEFAULT_KV_ASSUMPTION,
    DEFAULT_MAX_NUM_SEQS,
    DEFAULT_TYPICAL_SEQ_LEN,
    KV_ASSUMPTIONS,
)
from .hardware import GpuPartition, load_partitions
from .memory_model import (
    evaluate_fit,
    gib_from_bytes,
    kv_pool_required_gib,
    per_token_kv_bytes,
    per_token_kv_bytes_per_gpu,
    weights_per_gpu_gib,
)
from .model_metadata import ModelMetadata
from .overhead import total_overhead_gib, total_overhead_per_gpu_gib
from .ranking import (
    effective_su_per_hour,
    estimate_job_su,
    partition_job_su_sort_key,
    su_per_gpu_hour_for,
)
from .workload import ArchetypeTable, WorkloadArchetype, load_archetypes


@dataclass(frozen=True)
class Breakdown:
    weights_gib: float | None
    kv_pool_required_gib: float | None
    overhead_gib: float


@dataclass(frozen=True)
class AssumptionResult:
    kv_assumption: str
    tokens: float
    fits: bool | None  # None when weights/KV are unknown
    headroom_gib: float | None
    breakdown: Breakdown


@dataclass(frozen=True)
class PartitionFit:
    partition: str
    gpu_type: str
    vendor: str
    vram_gib: float
    supported: bool
    skipped_reason: str | None
    fits: bool | None
    headroom_gib: float | None
    breakdown: Breakdown
    kv_assumption_used: str
    both_assumptions: dict[str, AssumptionResult]
    su_per_gpu_hour: int | None = None
    effective_su_per_hour: int | None = None
    estimated_job_su: int | None = None
    # Capacity model: does vLLM start, and how much concurrency does the fixed
    # KV pool actually sustain (derived, not the ctx × max_num_seqs product).
    starts: bool | None = None
    kv_pool_gib: float | None = None
    kv_pool_tokens: int | None = None
    concurrent_at_full_context: int | None = None
    concurrent_at_typical: int | None = None


@dataclass(frozen=True)
class FitEstimate:
    model: ModelMetadata
    max_model_len: int
    max_num_seqs: int
    kv_assumption: str
    workload_archetype: str
    per_token_kv_bytes: float | None
    weights_gib: float | None
    partitions: list[PartitionFit]
    tensor_parallel_size: int = 1
    duration_hours: float | None = None
    cheapest_feasible_partition: str | None = None
    typical_seq_len: int | None = None
    warnings: list[str] = field(default_factory=list)


def _per_gpu_weights_gib(meta: ModelMetadata, tp_size: int) -> float | None:
    if meta.weights_bytes is None:
        return None
    if tp_size <= 1:
        return gib_from_bytes(meta.weights_bytes)
    return weights_per_gpu_gib(meta.weights_bytes, tp_size)


def _per_gpu_token_bytes(meta: ModelMetadata, tp_size: int) -> float | None:
    if not meta.kv_fields_known:
        return None
    if tp_size <= 1:
        return per_token_kv_bytes(
            meta.n_layers, meta.n_kv_heads, meta.head_dim, meta.kv_dtype_bytes
        )
    return per_token_kv_bytes_per_gpu(
        meta.n_layers, meta.n_kv_heads, meta.head_dim, meta.kv_dtype_bytes, tp_size
    )


def _partition_overhead_gib(
    partition: GpuPartition,
    *,
    meta: ModelMetadata,
    tp_size: int,
    max_num_seqs: int,
) -> float:
    _ = meta  # weights/KV sized elsewhere; overhead is batch-width calibrated
    if tp_size <= 1:
        return total_overhead_gib(
            partition.vram_gib_per_gpu,
            DEFAULT_GPU_MEMORY_UTILIZATION,
            partition.framework_overhead_gib,
            max_num_seqs,
        )
    return total_overhead_per_gpu_gib(
        partition.vram_gib_per_gpu,
        DEFAULT_GPU_MEMORY_UTILIZATION,
        partition.framework_overhead_gib,
        partition.tp_communication_buffer_gib,
        tp_size,
        max_num_seqs,
    )


def _su_rate(partition: GpuPartition) -> int | None:
    if partition.su_per_gpu_hour is not None:
        return partition.su_per_gpu_hour
    return su_per_gpu_hour_for(partition.partition, partition.gpu_type)


def _evaluate_partition(
    partition: GpuPartition,
    *,
    meta: ModelMetadata,
    tensor_parallel_size: int,
    token_counts: Mapping[str, float],
    kv_assumption: str,
    max_num_seqs: int,
    max_model_len: int,
    typical_seq_len: int,
) -> PartitionFit:
    weights_gib = _per_gpu_weights_gib(meta, tensor_parallel_size)
    per_token_bytes = _per_gpu_token_bytes(meta, tensor_parallel_size)
    overhead_gib = _partition_overhead_gib(
        partition,
        meta=meta,
        tp_size=tensor_parallel_size,
        max_num_seqs=max_num_seqs,
    )
    su_rate = _su_rate(partition)

    capacity: KvCapacity | None = None
    if partition.is_nvidia and weights_gib is not None and per_token_bytes is not None:
        capacity = kv_pool_capacity(
            weights_gib=weights_gib,
            overhead_gib=overhead_gib,
            vram_gib=partition.vram_gib_per_gpu,
            per_token_kv_bytes_per_gpu=per_token_bytes,
            max_model_len=max_model_len,
            typical_seq_len=typical_seq_len,
            max_num_seqs=max_num_seqs,
        )

    if not partition.is_nvidia:
        empty = Breakdown(weights_gib, None, overhead_gib)
        both = {
            name: AssumptionResult(name, token_counts[name], None, None, empty)
            for name in KV_ASSUMPTIONS
        }
        return PartitionFit(
            partition=partition.partition,
            gpu_type=partition.gpu_type,
            vendor=partition.vendor,
            vram_gib=partition.vram_gib_per_gpu,
            supported=False,
            skipped_reason="non-NVIDIA GPU (ROCm) not supported by this estimator",
            fits=None,
            headroom_gib=None,
            breakdown=empty,
            kv_assumption_used=kv_assumption,
            both_assumptions=both,
            su_per_gpu_hour=su_rate,
        )

    both: dict[str, AssumptionResult] = {}
    for name in KV_ASSUMPTIONS:
        tokens = token_counts[name]
        if per_token_bytes is None:
            kv_gib: float | None = None
        else:
            kv_gib = kv_pool_required_gib(per_token_bytes, tokens)

        if weights_gib is None or kv_gib is None:
            fits: bool | None = None
            headroom: float | None = None
        else:
            fit = evaluate_fit(
                weights_gib, kv_gib, overhead_gib, partition.vram_gib_per_gpu
            )
            fits, headroom = fit.fits, fit.headroom_gib

        both[name] = AssumptionResult(
            kv_assumption=name,
            tokens=tokens,
            fits=fits,
            headroom_gib=headroom,
            breakdown=Breakdown(weights_gib, kv_gib, overhead_gib),
        )

    primary = both[kv_assumption]
    return PartitionFit(
        partition=partition.partition,
        gpu_type=partition.gpu_type,
        vendor=partition.vendor,
        vram_gib=partition.vram_gib_per_gpu,
        supported=True,
        skipped_reason=None,
        fits=primary.fits,
        headroom_gib=primary.headroom_gib,
        breakdown=primary.breakdown,
        kv_assumption_used=kv_assumption,
        both_assumptions=both,
        su_per_gpu_hour=su_rate,
        starts=capacity.starts if capacity else None,
        kv_pool_gib=capacity.kv_pool_gib if capacity else None,
        kv_pool_tokens=capacity.kv_pool_tokens if capacity else None,
        concurrent_at_full_context=(
            capacity.concurrent_at_full_context if capacity else None
        ),
        concurrent_at_typical=(capacity.concurrent_at_typical if capacity else None),
    )


def estimate_fit(
    meta: ModelMetadata,
    *,
    max_model_len: int | None = None,
    max_num_seqs: int | None = None,
    kv_assumption: str = DEFAULT_KV_ASSUMPTION,
    workload_archetype: str | None = None,
    tensor_parallel_size: int = 1,
    duration_hours: float | None = None,
    typical_seq_len: int | None = None,
    partitions: Sequence[GpuPartition] | None = None,
    archetypes: ArchetypeTable | None = None,
) -> FitEstimate:
    """Compute per-partition fit for ``meta`` under both KV assumptions."""
    if kv_assumption not in KV_ASSUMPTIONS:
        raise ValueError(
            f"kv_assumption must be one of {KV_ASSUMPTIONS}, got {kv_assumption!r}"
        )
    if tensor_parallel_size < 1:
        raise ValueError(
            f"tensor_parallel_size must be >= 1, got {tensor_parallel_size}"
        )

    parts = tuple(partitions) if partitions is not None else load_partitions()
    table = archetypes if archetypes is not None else load_archetypes()
    archetype: WorkloadArchetype = table.get(workload_archetype)

    warnings: list[str] = []

    resolved_max_len = max_model_len or meta.max_position_embeddings
    if resolved_max_len is None:
        raise ValueError(
            "max_model_len not provided and model config has no "
            "max_position_embeddings"
        )
    if max_model_len is None:
        warnings.append(
            f"max_model_len defaulted to model max_position_embeddings "
            f"({resolved_max_len}); pass an explicit value for your workload"
        )

    resolved_max_seqs = max_num_seqs or DEFAULT_MAX_NUM_SEQS
    resolved_typical_len = typical_seq_len or DEFAULT_TYPICAL_SEQ_LEN

    if meta.weights_bytes is None:
        warnings.append("weights size unknown; fit cannot be determined")
    if not meta.kv_fields_known:
        warnings.append(
            "KV cache size unknown (missing config fields: "
            f"{', '.join(meta.unknown_fields)}); fit cannot be determined"
        )

    weights_gib = _per_gpu_weights_gib(meta, tensor_parallel_size)
    per_token_bytes = _per_gpu_token_bytes(meta, tensor_parallel_size)

    budget = resolved_max_len * resolved_max_seqs
    token_counts = {
        "worst_case": float(budget),
        "typical": budget * archetype.utilization_factor,
    }

    partition_fits = [
        _evaluate_partition(
            p,
            meta=meta,
            tensor_parallel_size=tensor_parallel_size,
            token_counts=token_counts,
            kv_assumption=kv_assumption,
            max_num_seqs=resolved_max_seqs,
            max_model_len=resolved_max_len,
            typical_seq_len=resolved_typical_len,
        )
        for p in parts
    ]

    cheapest: str | None = None
    if duration_hours is not None and duration_hours > 0:
        enriched: list[PartitionFit] = []
        for fit in partition_fits:
            su_rate = fit.su_per_gpu_hour
            if fit.supported and su_rate is not None and duration_hours > 0:
                job_rate = effective_su_per_hour(su_rate, tensor_parallel_size)
                job_su = estimate_job_su(su_rate, tensor_parallel_size, duration_hours)
                enriched.append(
                    replace(
                        fit,
                        su_per_gpu_hour=su_rate,
                        effective_su_per_hour=job_rate,
                        estimated_job_su=job_su,
                    )
                )
            else:
                enriched.append(fit)
        partition_fits = sorted(
            enriched,
            key=lambda p: partition_job_su_sort_key(
                feasible=p.starts,
                estimated_job_su=p.estimated_job_su,
                partition=p.partition,
            ),
        )
        cheapest = next(
            (
                p.partition
                for p in partition_fits
                if p.starts is True and p.estimated_job_su is not None
            ),
            None,
        )

    return FitEstimate(
        model=meta,
        max_model_len=resolved_max_len,
        max_num_seqs=resolved_max_seqs,
        kv_assumption=kv_assumption,
        workload_archetype=archetype.name,
        per_token_kv_bytes=per_token_bytes,
        weights_gib=weights_gib,
        partitions=partition_fits,
        tensor_parallel_size=tensor_parallel_size,
        duration_hours=duration_hours,
        cheapest_feasible_partition=cheapest,
        typical_seq_len=resolved_typical_len,
        warnings=warnings,
    )


def estimate_fit_for_model(
    model_id: str,
    *,
    dtype: str | None = None,
    max_model_len: int | None = None,
    max_num_seqs: int | None = None,
    kv_assumption: str = DEFAULT_KV_ASSUMPTION,
    workload_archetype: str | None = None,
    tensor_parallel_size: int = 1,
    duration_hours: float | None = None,
    typical_seq_len: int | None = None,
    revision: str = "main",
) -> FitEstimate:
    """Network-backed convenience wrapper: resolve ``model_id`` then estimate.

    This is the single seam that performs I/O; keep it thin so
    :func:`estimate_fit` stays pure and unit-testable.
    """
    from .model_metadata import fetch_model_metadata

    meta = fetch_model_metadata(model_id, dtype=dtype, revision=revision)
    return estimate_fit(
        meta,
        max_model_len=max_model_len,
        max_num_seqs=max_num_seqs,
        kv_assumption=kv_assumption,
        workload_archetype=workload_archetype,
        tensor_parallel_size=tensor_parallel_size,
        duration_hours=duration_hours,
        typical_seq_len=typical_seq_len,
    )
