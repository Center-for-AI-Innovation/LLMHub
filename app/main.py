"""
App entry point. Infrastructure is resolved first so VEC_INF_CONFIG_DIR is set
before any code (e.g. llm_inference) reads it at import time.
"""
import logging
import os

from app.config.config import settings
from app.utils.infrastructure import InfrastructureManager

# Resolve infrastructure and set VEC_INF_CONFIG_DIR before router/service imports
_infra_manager = InfrastructureManager()
_infra_id = _infra_manager.detect_infrastructure()
_infra_config_path = _infra_manager.get_config_path(_infra_id)
_infra_config_path_abs = _infra_config_path.resolve()
_infra_config_str = str(_infra_config_path_abs)
os.environ["VEC_INF_CONFIG_DIR"] = _infra_config_str
setattr(settings, "VEC_INF_CONFIG_DIR", _infra_config_str)

_logger = logging.getLogger(__name__)
_logger.info(
    "Infrastructure: %s -> VEC_INF_CONFIG_DIR=%s",
    _infra_id,
    _infra_config_path_abs,
)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.router import api_router
from app.services.background_service import background_service

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
)

# Set up CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API router
app.include_router(api_router, prefix=settings.API_V1_STR)


@app.on_event("startup")
async def startup_event():
    """Start background services on application startup."""
    await background_service.start()


@app.on_event("shutdown")
async def shutdown_event():
    """Stop background services on application shutdown."""
    await background_service.stop()


@app.get("/")
def root():
    """Root endpoint."""
    return {"message": "Welcome to the AI Inference Backend API"} 