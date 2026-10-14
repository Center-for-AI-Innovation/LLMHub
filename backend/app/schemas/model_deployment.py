import re
from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas._base import ORMBaseModel
from app.utils.cluster_users import normalize_cluster_username
from app.utils.slurm_accounts import is_valid_slurm_account_name

# vec-inf writes these into the job script unquoted and unescaped: the Slurm fields
# into ``#SBATCH --key=value`` lines (sbatch splits on whitespace, and a newline starts
# a shell line), and the launched model id into the script body. So allowlist, don't
# escape. Model ids follow vec-inf's own ModelConfig pattern, with a leading alphanumeric.
_MODEL_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$")
_SLURM_VALUE_RE = re.compile(r"^[A-Za-z0-9._:,+-]{1,128}$")
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x1f\x7f-\x9f]")


class ModelDeploymentCreate(BaseModel):
    """Schema for creating a model deployment."""

    model_config = ConfigDict(populate_by_name=True)

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
    resource_type: Optional[str] = (
        None  # GPU type (e.g., "l40s", "h100", "A100", "H200")
    )
    cluster_username: Optional[str] = Field(default=None, alias="clusterUsername")
    account: Optional[str] = None  # Slurm account selected by the submitting user
    work_dir: Optional[str] = None  # Optional working directory for vec-inf jobs
    hf_model: Optional[str] = (
        None  # HuggingFace model ID (e.g., "Qwen/Qwen2.5-3B-Instruct")
    )
    hf_token: Optional[str] = Field(
        default=None,
        repr=False,
        description="User HF token for gated/private weights; verified with auth_check before launch",
    )
    vllm_args: Optional[str] = (
        None  # Additional vLLM args (comma-separated, e.g., "--max-model-len=4096,--max-num-seqs=64")
    )
    model_weights_parent_dir: Optional[str] = None  # Parent directory for model weights
    enable_cloudflare_tunnel: Optional[bool] = (
        False  # Added flag for enabling Cloudflare tunnel
    )

    @model_validator(mode="after")
    def _default_model_id(self) -> "ModelDeploymentCreate":
        if self.modelId is None:
            self.modelId = self.modelName
        # modelId is what gets launched; checked here so the modelName default is too.
        if not _MODEL_ID_RE.fullmatch(self.modelId):
            raise ValueError(
                "modelId may only contain letters, digits, '.', '_' and '-'"
            )
        return self

    @field_validator("modelName")
    @classmethod
    def _validate_model_name(cls, value: str) -> str:
        # Display only (UI, email subjects), but still keep line breaks out of it.
        if _CONTROL_CHARS_RE.search(value):
            raise ValueError("modelName must not contain control characters")
        return value

    @field_validator("partition", "qos", "time", "resource_type", "data_type")
    @classmethod
    def _validate_slurm_value(cls, value: Optional[str], info) -> Optional[str]:
        if value is None or value == "":
            return value
        if not _SLURM_VALUE_RE.fullmatch(value):
            raise ValueError(
                f"{info.field_name} may only contain letters, digits and . _ : , + -"
            )
        return value

    @field_validator("cluster_username")
    @classmethod
    def _validate_cluster_username(cls, value: Optional[str]) -> Optional[str]:
        if value is None or not value.strip():
            return None
        try:
            return normalize_cluster_username(value)
        except ValueError as exc:
            raise ValueError(
                "clusterUsername must be a valid cluster login name"
            ) from exc

    @field_validator("account")
    @classmethod
    def _validate_account(cls, value: Optional[str]) -> Optional[str]:
        if value is None or not str(value).strip():
            return None
        account = str(value).strip()
        if not is_valid_slurm_account_name(account):
            raise ValueError("account must be a valid Slurm account name")
        return account


class ModelDeploymentUpdate(BaseModel):
    """Schema for updating a model deployment."""

    status: Optional[str] = None
    endpointUrl: Optional[str] = None
    proxyUrl: Optional[str] = None
    errorMessage: Optional[str] = None
    expiresAt: Optional[datetime] = None


class DeploymentNotifyAccessRequest(BaseModel):
    """Schema for requesting an access-granted email notification."""

    userId: UUID
    sharedByUserId: Optional[UUID] = None


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
