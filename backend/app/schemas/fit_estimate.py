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
        warnings=estimate.warnings,
        partitions=[_partition(p) for p in estimate.partitions],
    )
