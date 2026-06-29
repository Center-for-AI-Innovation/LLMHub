import logging
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
from app.utils.infrastructure import InfrastructureManager

router = APIRouter()
model_service = ModelService()
logger = logging.getLogger(__name__)

# Model Endpoints
@router.get("/launch-defaults", response_model=Dict[str, Any])
def get_launch_defaults() -> Dict[str, Any]:
    """Return infrastructure-specific default launch parameters from environment.yaml."""
    mgr = InfrastructureManager()
    env_config = mgr.get_environment_config()
    default_args = (env_config or {}).get("default_args")

    partition = default_args.get("partition")
    resource_type = default_args.get("resource_type")
    time = default_args.get("time")

    if not partition or not resource_type or not time:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Infrastructure configuration is missing required launch defaults (partition, resource_type, time).",
        )
    return {
        "partition": partition,
        "resource_type": resource_type,
        "time": time,
    }


@router.get("/", response_model=Dict[str, Any])
def list_available_models() -> Dict[str, Any]:
    """List available models."""
    return model_service.list_available_models()


@router.post("/sync", response_model=Dict[str, Any])
def sync_models(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Sync models with the database."""
    return model_service.sync_available_models(db=db)


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
def _launch_model(
    deployment: ModelDeploymentCreate,
    db: Session = Depends(get_db),
) -> Any:
    """Launch a model."""
    db_deployment = model_service.launch_model(db=db, deployment=deployment)
    if getattr(db_deployment, "status", None) == "failed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=getattr(db_deployment, "errorMessage", None) or "Failed to launch model",
        )
    return db_deployment


@router.post("/deployments", response_model=ModelDeploymentResponse, status_code=status.HTTP_201_CREATED)
def create_deployment(
    deployment: ModelDeploymentCreate,
    db: Session = Depends(get_db),
) -> Any:
    """Create (launch) a model deployment."""
    return _launch_model(deployment=deployment, db=db)


@router.get("/deployments", response_model=List[ModelDeploymentResponse])
def list_deployments(
    userId: Optional[UUID] = None,
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
) -> Any:
    """List model deployments with optional filters.
    
    Note: Deployments are retrieved from the database, not from vec-inf.
    The vec-inf package does not have a 'list deployments' command.
    """
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


@router.get("/deployments/{deployment_id}/logs", response_model=Dict[str, Any])
def get_deployment_logs(
    deployment_id: UUID,
    tail: int = 100,
    db: Session = Depends(get_db),
) -> Any:
    """Get logs for a specific model deployment.
    
    Args:
        deployment_id: UUID of the deployment
        tail: Number of lines to return from the end (default 100, 0 for all)
    """
    result = model_service.get_deployment_logs(db=db, deployment_id=deployment_id, tail=tail)
    if not result.get("success", False):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result.get("error", "Failed to get logs"),
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


@router.put("/deployments/{deployment_id}/extend", response_model=ModelDeploymentResponse)
def extend_deployment(
    deployment_id: UUID,
    extension_hours: int,
    db: Session = Depends(get_db),
) -> Any:
    """Extend the expiration time of a model deployment."""
    db_deployment = model_service.extend_deployment_expiration(
        db=db, deployment_id=deployment_id, extension_hours=extension_hours
    )
    if not db_deployment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Model deployment not found",
        )
    return db_deployment


# This generic endpoint should be defined AFTER all specific endpoints
@router.get("/{model_name}", response_model=Dict[str, Any])
def get_model_details(model_name: str) -> Dict[str, Any]:
    """Get details of a specific model."""
    return model_service.get_model_details(model_name) 
