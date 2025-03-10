from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.router import api_router
from app.config.config import settings
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