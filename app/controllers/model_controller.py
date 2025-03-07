from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.repositories.session import get_db
from app.schemas.model_deployment import (
    ModelDeploymentCreate,
    ModelDeploymentResponse,
    ModelDeploymentUpdate,
)
from app.schemas.model_request import (
    ModelRequestCreate,
    ModelRequestResponse,
    ModelRequestUpdate,
)
from app.services.model_service import ModelService

router = APIRouter()
model_service = ModelService()


# Model Endpoints
@router.get("/", response_model=Dict[str, Any])
def list_available_models() -> Dict[str, Any]:
    """List available models."""
    return model_service.list_available_models()


@router.get("/{model_name}", response_model=Dict[str, Any])
def get_model_details(model_name: str) -> Dict[str, Any]:
    """Get details of a specific model."""
    return model_service.get_model_details(model_name)


# Model Request Endpoints
@router.post("/request", response_model=ModelRequestResponse, status_code=status.HTTP_201_CREATED)
def create_model_request(
    request: ModelRequestCreate,
    db: Session = Depends(get_db),
) -> Any:
    """Create a new model request."""
    return model_service.create_model_request(db=db, request=request)


@router.get("/requests", response_model=List[ModelRequestResponse])
def list_model_requests(
    userId: Optional[UUID] = None,
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
) -> Any:
    """List model requests with optional filters."""
    return model_service.get_model_requests(
        db=db, user_id=userId, status=status, skip=skip, limit=limit
    )


@router.get("/requests/{request_id}", response_model=ModelRequestResponse)
def get_model_request(
    request_id: UUID,
    db: Session = Depends(get_db),
) -> Any:
    """Get a specific model request."""
    db_request = model_service.get_model_request(db=db, request_id=request_id)
    if not db_request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Model request not found",
        )
    return db_request


@router.put("/requests/{request_id}", response_model=ModelRequestResponse)
def update_model_request(
    request_id: UUID,
    request_update: ModelRequestUpdate,
    db: Session = Depends(get_db),
) -> Any:
    """Update a model request."""
    db_request = model_service.update_model_request(
        db=db, request_id=request_id, request_update=request_update
    )
    if not db_request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Model request not found",
        )
    return db_request


# Model Deployment Endpoints
@router.post("/launch", response_model=ModelDeploymentResponse, status_code=status.HTTP_201_CREATED)
def launch_model(
    deployment: ModelDeploymentCreate,
    db: Session = Depends(get_db),
) -> Any:
    """Launch a model."""
    return model_service.launch_model(db=db, deployment=deployment)


@router.get("/deployments", response_model=List[ModelDeploymentResponse])
def list_deployments(
    userId: Optional[UUID] = None,
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
) -> Any:
    """List model deployments with optional filters."""
    return model_service.get_deployments(
        db=db, user_id=userId, status=status, skip=skip, limit=limit
    )


@router.get("/deployments/{deployment_id}", response_model=ModelDeploymentResponse)
def get_deployment(
    deployment_id: UUID,
    db: Session = Depends(get_db),
) -> Any:
    """Get a specific model deployment."""
    db_deployment = model_service.get_deployment(db=db, deployment_id=deployment_id)
    if not db_deployment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Model deployment not found",
        )
    
    # Update the deployment status
    db_deployment = model_service.update_deployment_status(db=db, deployment_id=deployment_id)
    return db_deployment


@router.get("/deployments/{deployment_id}/metrics", response_model=Dict[str, Any])
def get_deployment_metrics(
    deployment_id: UUID,
    db: Session = Depends(get_db),
) -> Any:
    """Get metrics for a specific model deployment."""
    result = model_service.get_deployment_metrics(deployment_id=deployment_id, db=db)
    if not result.get("success", False):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result.get("error", "Failed to get metrics"),
        )
    return result


@router.delete("/deployments/{deployment_id}", response_model=ModelDeploymentResponse)
def shutdown_deployment(
    deployment_id: UUID,
    db: Session = Depends(get_db),
) -> Any:
    """Shutdown a model deployment."""
    db_deployment = model_service.shutdown_deployment(db=db, deployment_id=deployment_id)
    if not db_deployment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Model deployment not found",
        )
    return db_deployment 