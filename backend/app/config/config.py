from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List, Optional
import os


class Settings(BaseSettings):
    """Application settings."""
    
    # API settings
    API_V1_STR: str = "/api"
    PROJECT_NAME: str = "AI Inference Backend"
    
    # CORS settings
    BACKEND_CORS_ORIGINS: List[str] = ["*"]  # For development, will be restricted in production
    
    # Database settings
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/llm_service"
    
    # HPC settings
    SLURM_ACCOUNT: Optional[str] = None  # SLURM account for job submission
    DEFAULT_VENV: str = "apptainer"  # Default container runtime (apptainer/singularity)
    MODEL_CONFIG_PATH: Optional[str] = None  # Path to custom model configuration YAML file
    VEC_INF_CONFIG_DIR: Optional[str] = None  # Directory containing environment.yaml and models.yaml for vec-inf
    VEC_INF_ACCOUNT: Optional[str] = None  # SLURM account for vec-inf (can override SLURM_ACCOUNT)
    VEC_INF_WORK_DIR: Optional[str] = None  # Working directory for vec-inf jobs
    VEC_INF_ENV: Optional[str] = None  # Environment variables for container jobs (comma-separated KEY=VALUE pairs)
    
    # Background service settings
    SYNC_INTERVAL: int = int(os.getenv("SYNC_INTERVAL", "60"))  # deployment sync interval in seconds
    EXPIRY_CHECK_INTERVAL: int = int(os.getenv("EXPIRY_CHECK_INTERVAL", "300"))  # expiry check interval in seconds
    MAX_DEPLOYMENTS_PER_CYCLE: int = int(os.getenv("MAX_DEPLOYMENTS_PER_CYCLE", "10"))  # max deployments to process per cycle
    MODEL_SYNC_INTERVAL: int = int(os.getenv("MODEL_SYNC_INTERVAL", "3600"))  # seconds (default: 1 hour)

    # Email settings (unauthenticated campus SMTP relay, IP-restricted)
    SMTP_HOST: str = os.getenv("SMTP_HOST", "outbound-relays.techservices.illinois.edu")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "25"))
    SMTP_FROM: str = os.getenv("SMTP_FROM", "no-reply@illinois.edu")
    FRONTEND_URL: Optional[str] = os.getenv("FRONTEND_URL")  # Base URL of the Next.js frontend, linked in notification emails when set
    SUPPORT_EMAIL: Optional[str] = os.getenv("SUPPORT_EMAIL")  # Support contact shown in the admin-contact line of notification emails when set
    
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True)


settings = Settings() 
