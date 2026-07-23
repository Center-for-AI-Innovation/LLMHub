"""Request/response schemas for the pre-flight GPU fit estimator.

Thin (de)serialization layer over the pure dataclasses in
``app.services.fit_estimator``. :func:`to_response` converts a computed
:class:`~app.services.fit_estimator.estimator.FitEstimate` into the wire shape.
"""

from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.services.fit_estimator.estimator import FitEstimate, PartitionFit

KvAssumption = Literal["worst_case", "typical"]

# We use ``model_id`` / ``model`` field names, which collide with Pydantic v2's
# protected ``model_`` namespace; opt out to keep those names without warnings.
_ALLOW_MODEL_NAMES = ConfigDict(protected_namespaces=())


class FitEstimateRequest(BaseModel):
    """Job spec. Everything except ``model_id`` has a sensible default."""

    model_config = _ALLOW_MODEL_NAMES

    model_id: str = Field(..., description="Hugging Face model id or path")
    model_family: Optional[str] = Field(
        None,
        description="Catalog model family; used to resolve org/model when model_id has no slash",
    )
    huggingface_id: Optional[str] = Field(
        None,
        description="Explicit Hugging Face repo id override from the catalog",
    )
    dtype: Optional[str] = Field(
        None, description="Override compute dtype (e.g. float16, bfloat16, fp8)"
    )
    max_model_len: Optional[int] = Field(
        None, gt=0, description="Max sequence length; defaults to the model's config"
    )
    max_num_seqs: Optional[int] = Field(
        None, gt=0, description="Max concurrent sequences; defaults to vLLM's 256"
    )
    workload_archetype: Optional[str] = Field(
        None, description="chat | summarization | code | batch (for 'typical' KV)"
    )
    kv_assumption: KvAssumption = Field(
        "worst_case", description="Which KV assumption is primary; both are returned"
    )
    tensor_parallel_size: int = Field(
        1, ge=1, description="Tensor-parallel size (GPUs per node) for the survey"
    )
    typical_seq_len: Optional[int] = Field(
        None,
        gt=0,
        description="Expected average sequence length (tokens) for the capacity 'typical concurrency' figure; defaults to 4096",
    )
    duration_hours: Optional[float] = Field(
        None,
        gt=0,
        description="Job walltime in hours; when set, each partition includes estimated_job_su",
    )
    time: Optional[str] = Field(
        None,
        description="SLURM walltime (HH:MM:SS); alternative to duration_hours for SU estimate",
    )
    revision: str = Field("main", description="Model revision/branch on the Hub")


class BreakdownSchema(BaseModel):
    weights_gib: Optional[float]
    kv_pool_required_gib: Optional[float]
    overhead_gib: float


class AssumptionResultSchema(BaseModel):
    kv_assumption: str
    tokens: float
    fits: Optional[bool]
    headroom_gib: Optional[float]
    breakdown: BreakdownSchema


class PartitionFitSchema(BaseModel):
    partition: str
    gpu_type: str
    vendor: str
    vram_gib: float
    supported: bool
    skipped_reason: Optional[str]
    fits: Optional[bool]
    headroom_gib: Optional[float]
    breakdown: BreakdownSchema
    kv_assumption_used: str
    both_assumptions: Dict[str, AssumptionResultSchema]
    su_per_gpu_hour: Optional[int] = None
    effective_su_per_hour: Optional[int] = Field(
        default=None,
        description="Aggregate SU/hour for the requested GPU count (per-GPU rate × num_gpus)",
    )
    estimated_job_su: Optional[int] = None
    # Capacity model (how vLLM actually behaves): does it boot, and how many
    # concurrent sequences the fixed KV pool sustains — derived, not assumed.
    starts: Optional[bool] = Field(
        default=None,
        description="True when the KV pool holds ≥ 1 full-context sequence (vLLM boot check)",
    )
    kv_pool_gib: Optional[float] = Field(
        default=None,
        description="Per-GPU VRAM left for the KV pool after weights + overhead",
    )
    kv_pool_tokens: Optional[int] = Field(
        default=None, description="Total tokens the fixed KV pool can hold (per GPU)"
    )
    concurrent_at_full_context: Optional[int] = Field(
        default=None,
        description="Sustainable concurrent sequences at full max_model_len (capped by max_num_seqs)",
    )
    concurrent_at_typical: Optional[int] = Field(
        default=None,
        description="Sustainable concurrent sequences at typical_seq_len (capped by max_num_seqs)",
    )


class ModelSummarySchema(BaseModel):
    model_config = _ALLOW_MODEL_NAMES

    model_id: str
    dtype: str
    n_layers: Optional[int]
    n_kv_heads: Optional[int]
    head_dim: Optional[int]
    weights_gib: Optional[float]
    weights_source: str
    quantization: Optional[str]
    unknown_fields: List[str]


class FitEstimateResponse(BaseModel):
    model_config = _ALLOW_MODEL_NAMES

    model: ModelSummarySchema
    max_model_len: int
    max_num_seqs: int
    kv_assumption: str
    workload_archetype: str
    per_token_kv_bytes: Optional[float]
    tensor_parallel_size: int
    duration_hours: Optional[float]
    cheapest_feasible_partition: Optional[str]
    typical_seq_len: Optional[int] = None
    warnings: List[str]
    partitions: List[PartitionFitSchema]


def _breakdown(fit_breakdown) -> BreakdownSchema:
    return BreakdownSchema(
        weights_gib=fit_breakdown.weights_gib,
        kv_pool_required_gib=fit_breakdown.kv_pool_required_gib,
        overhead_gib=fit_breakdown.overhead_gib,
    )


def _partition(fit: PartitionFit) -> PartitionFitSchema:
    return PartitionFitSchema(
        partition=fit.partition,
        gpu_type=fit.gpu_type,
        vendor=fit.vendor,
        vram_gib=fit.vram_gib,
        supported=fit.supported,
        skipped_reason=fit.skipped_reason,
        fits=fit.fits,
        headroom_gib=fit.headroom_gib,
        breakdown=_breakdown(fit.breakdown),
        kv_assumption_used=fit.kv_assumption_used,
        both_assumptions={
            name: AssumptionResultSchema(
                kv_assumption=res.kv_assumption,
                tokens=res.tokens,
                fits=res.fits,
                headroom_gib=res.headroom_gib,
                breakdown=_breakdown(res.breakdown),
            )
            for name, res in fit.both_assumptions.items()
        },
        su_per_gpu_hour=fit.su_per_gpu_hour,
        effective_su_per_hour=fit.effective_su_per_hour,
        estimated_job_su=fit.estimated_job_su,
        starts=fit.starts,
        kv_pool_gib=fit.kv_pool_gib,
        kv_pool_tokens=fit.kv_pool_tokens,
        concurrent_at_full_context=fit.concurrent_at_full_context,
        concurrent_at_typical=fit.concurrent_at_typical,
    )


def to_response(estimate: FitEstimate) -> FitEstimateResponse:
    """Convert a computed :class:`FitEstimate` into the API response schema."""
    meta = estimate.model
    return FitEstimateResponse(
        model=ModelSummarySchema(
            model_id=meta.source_model,
            dtype=meta.dtype,
            n_layers=meta.n_layers,
            n_kv_heads=meta.n_kv_heads,
            head_dim=meta.head_dim,
            weights_gib=estimate.weights_gib,
            weights_source=meta.weights_source,
            quantization=meta.quantization,
            unknown_fields=meta.unknown_fields,
        ),
        max_model_len=estimate.max_model_len,
        max_num_seqs=estimate.max_num_seqs,
        kv_assumption=estimate.kv_assumption,
        workload_archetype=estimate.workload_archetype,
        per_token_kv_bytes=estimate.per_token_kv_bytes,
        tensor_parallel_size=estimate.tensor_parallel_size,
        duration_hours=estimate.duration_hours,
        cheapest_feasible_partition=estimate.cheapest_feasible_partition,
        typical_seq_len=estimate.typical_seq_len,
        warnings=estimate.warnings,
        partitions=[_partition(p) for p in estimate.partitions],
    )
