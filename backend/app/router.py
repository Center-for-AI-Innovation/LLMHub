from fastapi import APIRouter

from app.controllers import (
    fit_controller,
    health_controller,
    model_controller,
    resource_controller,
    validate_controller,
)

api_router = APIRouter()
api_router.include_router(health_controller.router, prefix="/health", tags=["health"])
api_router.include_router(model_controller.router, prefix="/models", tags=["models"])
api_router.include_router(
    resource_controller.router, prefix="/resources", tags=["resources"]
)
api_router.include_router(
    fit_controller.router, prefix="/fit-estimate", tags=["fit-estimate"]
)
api_router.include_router(
    validate_controller.router,
    prefix="/validate-config",
    tags=["validate-config"],
)
