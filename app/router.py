from fastapi import APIRouter

from app.controllers import health_controller, model_controller

api_router = APIRouter()
api_router.include_router(health_controller.router, prefix="/health", tags=["health"])
api_router.include_router(model_controller.router, prefix="/models", tags=["models"]) 