from datetime import datetime
from typing import Optional, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field, model_validator

from app.schemas._base import ORMBaseModel


class ModelDeploymentCreate(BaseModel):
    """Schema for creating a model deployment."""

    # Required fields
    modelName: str
    userId: UUID

    # Optional extra identifier (kept for DB/clients that distinguish id vs display name)
    # Defaults to modelName for backwards compatibility.
    modelId: Optional[str] = None

    # Optional parameters for model deployment
    num_gpus: Optional[int] = None
    num_nodes: Optional[int] = None
    max_model_len: Optional[int] = None
    max_num_seqs: Optional[int] = None
    partition: Optional[str] = None
    qos: Optional[str] = None
    time: Optional[str] = None
    data_type: Optional[str] = None
    resource_type: Optional[str] = None  # GPU type (e.g., "l40s", "h100", "A100", "H200")
    work_dir: Optional[str] = None  # Optional working directory for vec-inf jobs
    hf_model: Optional[str] = None  # HuggingFace model ID (e.g., "Qwen/Qwen2.5-3B-Instruct")
    hf_token: Optional[str] = Field(
        default=None,
        repr=False,
        description="User HF token for gated/private weights; verified with auth_check before launch",
    )
    vllm_args: Optional[str] = None  # Additional vLLM args (comma-separated, e.g., "--max-model-len=4096,--max-num-seqs=64")
    model_weights_parent_dir: Optional[str] = None  # Parent directory for model weights
    enable_cloudflare_tunnel: Optional[bool] = False  # Added flag for enabling Cloudflare tunnel

    @model_validator(mode="after")
    def _default_model_id(self) -> "ModelDeploymentCreate":
        if self.modelId is None:
            self.modelId = self.modelName
        return self


class ModelDeploymentUpdate(BaseModel):
    """Schema for updating a model deployment."""
    
    status: Optional[str] = None
    endpointUrl: Optional[str] = None
    proxyUrl: Optional[str] = None
    errorMessage: Optional[str] = None
    expiresAt: Optional[datetime] = None


class ModelDeploymentInDB(ORMBaseModel):
    """Schema for a model deployment in the database."""
    
    id: UUID
    modelId: str
    modelName: str
    userId: UUID
    slurmJobId: str
    status: str
    createdAt: datetime
    updatedAt: datetime
    endpointUrl: Optional[str] = None
    proxyUrl: Optional[str] = None
    errorMessage: Optional[str] = None
    resourceAllocation: Optional[Dict[str, Any]] = None
    expiresAt: Optional[datetime] = None


class ModelDeploymentResponse(ModelDeploymentInDB):
    """Schema for a model deployment response."""
    pass
