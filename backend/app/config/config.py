import os
from enum import Enum
from pathlib import Path
from typing import List, Optional

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class VecInfExecutionMode(str, Enum):
    """How the backend submits vec-inf Slurm jobs."""

    DIRECT = "direct"
    IMPERSONATE = "impersonate"


def _readable_dotenv_path() -> Optional[str]:
    """Return ``.env`` only when this process can read it.

    Impersonated launches run as ``svcllmhub*`` with cwd in the backend tree.
    They must not open the service account's ``.env`` (PermissionError). Values
    needed for the shim are already in ``os.environ`` via sudo ``--preserve-env``.
    """
    candidate = Path(".env")
    try:
        if candidate.is_file() and os.access(candidate, os.R_OK):
            return str(candidate)
    except OSError:
        # is_file()/stat can raise PermissionError when the file is inaccessible.
        return None
    return None


class Settings(BaseSettings):
    """Application settings.

    All configuration is loaded here from environment / ``.env``. Callers should
    read fields from this object rather than calling ``os.getenv`` themselves.
    Use :meth:`apply_vec_inf_environ` to push vec-inf-related values into
    ``os.environ`` for libraries that only read the process environment.
    """

    # API settings
    API_V1_STR: str = "/api"
    PROJECT_NAME: str = "AI Inference Backend"

    # CORS settings
    BACKEND_CORS_ORIGINS: List[str] = [
        "*"
    ]  # For development, will be restricted in production

    # Database settings
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/llm_service"

    # Infrastructure selection (also readable via Settings; previously env-only)
    INFRASTRUCTURE: Optional[str] = None

    # HPC settings
    SLURM_ACCOUNT: Optional[str] = None  # SLURM account for job submission
    DEFAULT_VENV: str = "apptainer"  # Default container runtime (apptainer/singularity)
    MODEL_CONFIG_PATH: Optional[str] = (
        None  # Path to custom model configuration YAML file
    )
    VEC_INF_CONFIG_DIR: Optional[str] = (
        None  # Directory containing environment.yaml and models.yaml for vec-inf
    )
    VEC_INF_ACCOUNT: Optional[str] = (
        None  # SLURM account for vec-inf (can override SLURM_ACCOUNT)
    )
    # Direct-mode job work directory. In impersonate mode, prefer
    # VEC_INF_SHARED_WORK_ROOT (see resolve_workspace_root).
    VEC_INF_WORK_DIR: Optional[str] = None
    VEC_INF_ENV: Optional[str] = (
        None  # Environment variables for container jobs (comma-separated KEY=VALUE pairs)
    )
    VEC_INF_LOG_DIR: Optional[str] = None  # Shared vec-inf log directory override
    # Parent for impersonated per-user workspaces (<root>/<cluster_username>).
    # Falls back to VEC_INF_WORK_DIR, then VEC_INF_LOG_DIR when unset.
    VEC_INF_SHARED_WORK_ROOT: Optional[str] = None
    VEC_INF_EXECUTION_MODE: VecInfExecutionMode = VecInfExecutionMode.DIRECT
    VEC_INF_IMPERSONATE_SCRIPT: str = str(
        Path(__file__).resolve().parents[2] / "scripts" / "impersonate-wrapper.py"
    )
    VEC_INF_IMPERSONATE_PYTHON: Optional[str] = (
        None  # Shared interpreter path for impersonated shim launches
    )
    # Deprecated: accounts are resolved via sacctmgr. Kept so existing .env files still load.
    VEC_INF_ACCOUNTS_SCRIPT: Optional[str] = None
    VEC_INF_MODEL_CONFIG: Optional[str] = None  # Explicit models.yaml override
    # Shared caches cleaned by scripts/evict_unused_models.py
    MODEL_CACHE_DIR: Optional[str] = None
    COMPILE_CACHE_DIR: Optional[str] = None
    # Shared store of all model weights, keyed by model name; gated models are
    # hard-linked from here into the launching user's workspace (VEC_INF_SHARED_WORK_ROOT)
    MODEL_STORE_ROOT: Optional[str] = None

    # Background service settings
    SYNC_INTERVAL: int = 60  # deployment sync interval in seconds
    EXPIRY_CHECK_INTERVAL: int = 300  # expiry check interval in seconds
    MAX_DEPLOYMENTS_PER_CYCLE: int = 10  # max deployments to process per cycle
    MODEL_SYNC_INTERVAL: int = 3600  # seconds (default: 1 hour)

    # Email settings (unauthenticated campus SMTP relay, IP-restricted)
    SMTP_HOST: str = "outbound-relays.techservices.illinois.edu"
    SMTP_PORT: int = 25
    SMTP_FROM: str = "no-reply@illinois.edu"
    FRONTEND_URL: Optional[str] = (
        None  # Base URL of the Next.js frontend, linked in notification emails when set
    )
    SUPPORT_EMAIL: Optional[str] = (
        None  # Support contact shown in the admin-contact line of notification emails when set
    )

    model_config = SettingsConfigDict(
        env_file=_readable_dotenv_path(),
        case_sensitive=True,
    )

    @field_validator("VEC_INF_EXECUTION_MODE", mode="before")
    @classmethod
    def _normalize_execution_mode(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip().lower()
        return value

    def resolve_workspace_root(self) -> Optional[str]:
        """Parent directory for job workspaces.

        Preference order consolidates the historical WORK_DIR / SHARED_WORK_ROOT
        / LOG_DIR split:

        1. ``VEC_INF_SHARED_WORK_ROOT`` (impersonate per-user parent)
        2. ``VEC_INF_WORK_DIR`` (direct-mode work dir; also usable as parent)
        3. ``VEC_INF_LOG_DIR`` (legacy shared log root fallback)
        """
        for candidate in (
            self.VEC_INF_SHARED_WORK_ROOT,
            self.VEC_INF_WORK_DIR,
            self.VEC_INF_LOG_DIR,
        ):
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
        return None

    def resolve_direct_work_dir(self) -> Optional[str]:
        """Work directory exported for direct-mode vec-inf launches."""
        for candidate in (self.VEC_INF_WORK_DIR, self.VEC_INF_SHARED_WORK_ROOT):
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
        return None

    def apply_vec_inf_environ(self) -> None:
        """Copy Settings into ``os.environ`` for vec-inf / subprocess consumers.

        Only fills keys that are not already set in the process environment so
        explicit shell exports still win.
        """
        account = self.VEC_INF_ACCOUNT or self.SLURM_ACCOUNT
        mapping = {
            "VEC_INF_CONFIG_DIR": self.VEC_INF_CONFIG_DIR,
            "VEC_INF_ACCOUNT": account,
            "SLURM_ACCOUNT": self.SLURM_ACCOUNT or account,
            "VEC_INF_WORK_DIR": self.resolve_direct_work_dir(),
            "VEC_INF_LOG_DIR": self.VEC_INF_LOG_DIR,
            "VEC_INF_SHARED_WORK_ROOT": self.resolve_workspace_root(),
            "VEC_INF_ENV": self.VEC_INF_ENV,
            "VEC_INF_MODEL_CONFIG": self.VEC_INF_MODEL_CONFIG or self.MODEL_CONFIG_PATH,
            "INFRASTRUCTURE": self.INFRASTRUCTURE,
        }
        for key, value in mapping.items():
            if value is None:
                continue
            text = str(value).strip()
            if not text:
                continue
            if not os.environ.get(key):
                os.environ[key] = text


settings = Settings()
