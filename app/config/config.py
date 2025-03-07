from pydantic_settings import BaseSettings
from typing import List, Optional


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
    SLURM_LOG_DIR: Optional[str] = None  # Default log directory for Slurm jobs
    SLURM_ACCOUNT: Optional[str] = None  # SLURM account for job submission
    
    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings() 