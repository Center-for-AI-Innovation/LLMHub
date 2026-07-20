from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.repositories.session import get_db
from app.schemas.resource_allocation import (
    ResourceAllocationCreate,
    ResourceAllocationResponse,
    ResourceAllocationUpdate,
)
from app.services.resource_service import ResourceService

router = APIRouter()
resource_service = ResourceService()


@router.post(
    "/", response_model=ResourceAllocationResponse, status_code=status.HTTP_201_CREATED
)
def create_resource(
    resource: ResourceAllocationCreate,
    db: Session = Depends(get_db),
) -> Any:
    """Create a new resource allocation."""
    return resource_service.create_resource(db=db, resource=resource)


@router.get("/", response_model=List[ResourceAllocationResponse])
def list_resources(
    resourceType: Optional[str] = None,
    resourceName: Optional[str] = None,
    isActive: Optional[bool] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
) -> Any:
    """List resource allocations with optional filters."""
    return resource_service.get_resources(
        db=db,
        resource_type=resourceType,
        resource_name=resourceName,
        is_active=isActive,
        skip=skip,
        limit=limit,
    )


@router.get("/summary", response_model=Dict[str, Any])
def get_resource_summary(
    db: Session = Depends(get_db),
) -> Any:
    """Get a summary of resource allocations."""
    return resource_service.get_resource_summary(db=db)


@router.get("/{resource_id}", response_model=ResourceAllocationResponse)
def get_resource(
    resource_id: UUID,
    db: Session = Depends(get_db),
) -> Any:
    """Get a specific resource allocation."""
    db_resource = resource_service.get_resource(db=db, resource_id=resource_id)
    if not db_resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource allocation not found",
        )
    return db_resource


@router.put("/{resource_id}", response_model=ResourceAllocationResponse)
def update_resource(
    resource_id: UUID,
    resource_update: ResourceAllocationUpdate,
    db: Session = Depends(get_db),
) -> Any:
    """Update a resource allocation."""
    db_resource = resource_service.update_resource(
        db=db, resource_id=resource_id, resource_update=resource_update
    )
    if not db_resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource allocation not found",
        )
    return db_resource
