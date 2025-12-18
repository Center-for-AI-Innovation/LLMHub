from datetime import datetime
from typing import Optional, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field


class ModelDeploymentBase(BaseModel):
    """Base model deployment schema."""
    
    modelName: str
    userId: UUID


class ModelDeploymentCreate(ModelDeploymentBase):
    """Schema for creating a model deployment."""
    
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
    enable_cloudflare_tunnel: Optional[bool] = False  # Added flag for enabling Cloudflare tunnel


class ModelDeploymentUpdate(BaseModel):
    """Schema for updating a model deployment."""
    
    status: Optional[str] = None
    endpointUrl: Optional[str] = None
    tunnelUrl: Optional[str] = None  # Added field for Cloudflare tunnel URL
    errorMessage: Optional[str] = None
    expirationTime: Optional[datetime] = None


class ModelDeploymentInDB(ModelDeploymentBase):
    """Schema for a model deployment in the database."""
    
    id: UUID
    slurmJobId: str
    status: str
    createdAt: datetime
    updatedAt: datetime
    endpointUrl: Optional[str] = None
    tunnelUrl: Optional[str] = None  # Added field for Cloudflare tunnel URL
    errorMessage: Optional[str] = None
    resourceAllocation: Optional[Dict[str, Any]] = None
    expirationTime: Optional[datetime] = None
    
    class Config:
        orm_mode = True
        from_attributes = True


class ModelDeploymentResponse(ModelDeploymentInDB):
    """Schema for a model deployment response."""
    pass 