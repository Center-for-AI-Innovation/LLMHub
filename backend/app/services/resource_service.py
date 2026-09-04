"""Service for resource allocation management."""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.resource_allocation import ResourceAllocation
from app.schemas.resource_allocation import (
    ResourceAllocationCreate,
    ResourceAllocationUpdate,
)

logger = logging.getLogger(__name__)


class ResourceService:
    """Service for resource allocation management."""

    def create_resource(
        self, db: Session, resource: ResourceAllocationCreate
    ) -> ResourceAllocation:
        """Create a new resource allocation."""
        db_resource = ResourceAllocation(
            resourceType=resource.resourceType,
            resourceName=resource.resourceName,
            totalCount=resource.totalCount,
            allocatedCount=resource.allocatedCount,
            isActive=resource.isActive,
        )
        db.add(db_resource)
        db.commit()
        db.refresh(db_resource)
        return db_resource

    def get_resource(
        self, db: Session, resource_id: UUID
    ) -> Optional[ResourceAllocation]:
        """Get a resource allocation by ID."""
        return (
            db.query(ResourceAllocation)
            .filter(ResourceAllocation.id == resource_id)
            .first()
        )

    def get_resources(
        self,
        db: Session,
        resource_type: Optional[str] = None,
        resource_name: Optional[str] = None,
        is_active: Optional[bool] = True,
        skip: int = 0,
        limit: int = 100,
    ) -> List[ResourceAllocation]:
        """Get resource allocations with optional filters."""
        query = db.query(ResourceAllocation)

        if resource_type:
            query = query.filter(ResourceAllocation.resourceType == resource_type)

        if resource_name:
            query = query.filter(ResourceAllocation.resourceName == resource_name)

        if is_active is not None:
            query = query.filter(ResourceAllocation.isActive == is_active)

        return (
            query.order_by(ResourceAllocation.createdAt.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )

    def update_resource(
        self, db: Session, resource_id: UUID, resource_update: ResourceAllocationUpdate
    ) -> Optional[ResourceAllocation]:
        """Update a resource allocation."""
        db_resource = self.get_resource(db, resource_id)
        if not db_resource:
            return None

        update_data = resource_update.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(db_resource, key, value)

        db_resource.updatedAt = datetime.utcnow()
        db.commit()
        db.refresh(db_resource)
        return db_resource

    def allocate_resources(
        self, db: Session, resource_type: str, resource_name: str, count: int
    ) -> Dict[str, Any]:
        """Allocate resources."""
        # Get the resource allocation
        db_resource = (
            db.query(ResourceAllocation)
            .filter(
                ResourceAllocation.resourceType == resource_type,
                ResourceAllocation.resourceName == resource_name,
                ResourceAllocation.isActive.is_(True),
            )
            .first()
        )

        if not db_resource:
            return {
                "success": False,
                "error": f"Resource {resource_type}/{resource_name} not found or not active",
            }

        # Check if there are enough resources
        if db_resource.totalCount - db_resource.allocatedCount < count:
            return {
                "success": False,
                "error": f"Not enough resources available. Requested: {count}, Available: {db_resource.totalCount - db_resource.allocatedCount}",
            }

        # Allocate resources
        db_resource.allocatedCount += count
        db_resource.updatedAt = datetime.utcnow()
        db.commit()
        db.refresh(db_resource)

        return {
            "success": True,
            "resource": db_resource,
            "allocated": count,
            "remaining": db_resource.totalCount - db_resource.allocatedCount,
        }

    def release_resources(
        self, db: Session, resource_type: str, resource_name: str, count: int
    ) -> Dict[str, Any]:
        """Release resources."""
        # Get the resource allocation
        db_resource = (
            db.query(ResourceAllocation)
            .filter(
                ResourceAllocation.resourceType == resource_type,
                ResourceAllocation.resourceName == resource_name,
                ResourceAllocation.isActive.is_(True),
            )
            .first()
        )

        if not db_resource:
            return {
                "success": False,
                "error": f"Resource {resource_type}/{resource_name} not found or not active",
            }

        # Check if there are enough allocated resources to release
        if db_resource.allocatedCount < count:
            logger.warning(
                f"Attempting to release more resources than allocated. Allocated: {db_resource.allocatedCount}, Releasing: {count}"
            )
            count = db_resource.allocatedCount

        # Release resources
        db_resource.allocatedCount -= count
        db_resource.updatedAt = datetime.utcnow()
        db.commit()
        db.refresh(db_resource)

        return {
            "success": True,
            "resource": db_resource,
            "released": count,
            "remaining": db_resource.totalCount - db_resource.allocatedCount,
        }

    def get_resource_summary(self, db: Session) -> Dict[str, Any]:
        """Get a summary of resource allocations."""
        resources = self.get_resources(db, is_active=True, limit=1000)

        summary = {"total": {"gpu": 0, "allocated_gpu": 0}, "by_type": {}}

        for resource in resources:
            # Add to total if it's a GPU
            if resource.resourceType.lower() == "gpu":
                summary["total"]["gpu"] += resource.totalCount
                summary["total"]["allocated_gpu"] += resource.allocatedCount

            # Add to by_type summary
            resource_key = (
                f"{resource.resourceType.lower()}_{resource.resourceName.lower()}"
            )
            summary["by_type"][resource_key] = {
                "total": resource.totalCount,
                "allocated": resource.allocatedCount,
                "available": resource.totalCount - resource.allocatedCount,
            }

        return summary
