"""Request/response schemas for the pre-launch config validation gate.

Thin (de)serialization over :mod:`app.services.fit_estimator.validator`. The
request is the user's proposed launch config; the response is the gate verdict.
No ``kv_assumption`` here on purpose -- validation is always worst-case.
"""

from __future__ import annotations

from typing import Any, List, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.services.fit_estimator.validator import ConfigValidation

# ``model_id`` collides with Pydantic v2's protected ``model_`` namespace.
_ALLOW_MODEL_NAMES = ConfigDict(protected_namespaces=())


class ValidateConfigRequest(BaseModel):
    """A concrete proposed launch config to certify."""

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
    max_model_len: int = Field(
        ..., gt=0, description="Declared context window (required)"
    )
    tensor_parallel_size: int = Field(
        ..., ge=1, description="Number of GPUs the model is sharded across (TP)"
    )
    partition: str = Field(..., description="Delta partition name, e.g. gpuA40x4")
    num_nodes: int = Field(1, ge=1, description="Node count; >1 is not yet supported")
    dtype: Optional[str] = Field(
        None, description="Override compute dtype (e.g. float16, bfloat16, fp8)"
    )
    revision: str = Field("main", description="Model revision/branch on the Hub")


class PerGpuBreakdownSchema(BaseModel):
    weights_gib: Optional[float]
    kv_pool_required_gib: Optional[float]
    overhead_gib: Optional[float]
    total_gib: Optional[float]
    vram_gib: Optional[float]
    headroom_gib: Optional[float]


class ValidateConfigResponse(BaseModel):
    valid: bool
    reason: str
    per_gpu_breakdown: PerGpuBreakdownSchema
    warnings: List[str]
    # Seam, always null on this branch: whether to suggest a smaller/larger
    # config is an open product decision (field built, not populated).
    min_sufficient_config: Optional[Any] = None
    # Seam for warn-not-block rollout; set by the pipeline, not the estimator.
    advisory_only: Optional[bool] = None


def to_response(result: ConfigValidation) -> ValidateConfigResponse:
    """Convert a :class:`ConfigValidation` verdict into the API response."""
    b = result.per_gpu_breakdown
    return ValidateConfigResponse(
        valid=result.valid,
        reason=result.reason,
        per_gpu_breakdown=PerGpuBreakdownSchema(
            weights_gib=b.weights_gib,
            kv_pool_required_gib=b.kv_pool_required_gib,
            overhead_gib=b.overhead_gib,
            total_gib=b.total_gib,
            vram_gib=b.vram_gib,
            headroom_gib=b.headroom_gib,
        ),
        warnings=result.warnings,
        min_sufficient_config=result.min_sufficient_config,
        advisory_only=result.advisory_only,
    )
