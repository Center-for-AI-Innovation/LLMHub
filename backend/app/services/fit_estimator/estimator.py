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

from dataclasses import dataclass, field
from typing import Any, Mapping, Sequence

from .constants import (
    DEFAULT_KV_ASSUMPTION,
    DEFAULT_MAX_NUM_SEQS,
    KV_ASSUMPTIONS,
)
from .hardware import GpuPartition, load_partitions
from .memory_model import (
    evaluate_fit,
    gib_from_bytes,
    kv_pool_required_gib,
    per_token_kv_bytes,
)
from .model_metadata import ModelMetadata
from .overhead import total_overhead_gib
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
    warnings: list[str] = field(default_factory=list)


def _overhead_model_config(meta: ModelMetadata) -> dict[str, Any]:
    """Minimal config dict handed to the (stubbed) activation overhead term."""
    return {
        "num_hidden_layers": meta.n_layers,
        "hidden_size": meta.hidden_size,
        "num_attention_heads": meta.n_attention_heads,
    }


def _evaluate_partition(
    partition: GpuPartition,
    *,
    weights_gib: float | None,
    per_token_bytes: float | None,
    token_counts: Mapping[str, float],
    overhead_gib: float,
    kv_assumption: str,
) -> PartitionFit:
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
    )


def estimate_fit(
    meta: ModelMetadata,
    *,
    max_model_len: int | None = None,
    max_num_seqs: int | None = None,
    kv_assumption: str = DEFAULT_KV_ASSUMPTION,
    workload_archetype: str | None = None,
    partitions: Sequence[GpuPartition] | None = None,
    archetypes: ArchetypeTable | None = None,
) -> FitEstimate:
    """Compute per-partition fit for ``meta`` under both KV assumptions."""
    if kv_assumption not in KV_ASSUMPTIONS:
        raise ValueError(
            f"kv_assumption must be one of {KV_ASSUMPTIONS}, got {kv_assumption!r}"
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

    if meta.weights_bytes is None:
        warnings.append("weights size unknown; fit cannot be determined")
    if not meta.kv_fields_known:
        warnings.append(
            "KV cache size unknown (missing config fields: "
            f"{', '.join(meta.unknown_fields)}); fit cannot be determined"
        )

    weights_gib = (
        gib_from_bytes(meta.weights_bytes) if meta.weights_bytes is not None else None
    )
    per_token_bytes = (
        per_token_kv_bytes(
            meta.n_layers, meta.n_kv_heads, meta.head_dim, meta.kv_dtype_bytes
        )
        if meta.kv_fields_known
        else None
    )

    budget = resolved_max_len * resolved_max_seqs
    token_counts = {
        "worst_case": float(budget),
        "typical": budget * archetype.utilization_factor,
    }

    # Overhead is assumption-independent (framework constant + stubbed
    # activation term). max_batched_tokens is a placeholder input to the stub.
    overhead_config = _overhead_model_config(meta)

    partition_fits = [
        _evaluate_partition(
            p,
            weights_gib=weights_gib,
            per_token_bytes=per_token_bytes,
            token_counts=token_counts,
            overhead_gib=total_overhead_gib(
                p.framework_overhead_gib, overhead_config, resolved_max_seqs
            ),
            kv_assumption=kv_assumption,
        )
        for p in parts
    ]

    return FitEstimate(
        model=meta,
        max_model_len=resolved_max_len,
        max_num_seqs=resolved_max_seqs,
        kv_assumption=kv_assumption,
        workload_archetype=archetype.name,
        per_token_kv_bytes=per_token_bytes,
        weights_gib=weights_gib,
        partitions=partition_fits,
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
    )
