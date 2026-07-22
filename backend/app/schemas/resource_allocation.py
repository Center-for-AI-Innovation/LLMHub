from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, computed_field

from app.schemas._base import ORMBaseModel


class ResourceAllocationBase(BaseModel):
    """Base resource allocation schema."""

    resourceType: str
    resourceName: str
    totalCount: int
    allocatedCount: int = 0
    isActive: bool = True


class ResourceAllocationCreate(ResourceAllocationBase):
    """Schema for creating a resource allocation."""

    pass


class ResourceAllocationUpdate(BaseModel):
    """Schema for updating a resource allocation."""

    totalCount: Optional[int] = None
    allocatedCount: Optional[int] = None
    isActive: Optional[bool] = None


class ResourceAllocationInDB(ResourceAllocationBase):
    """Schema for a resource allocation in the database."""

    id: UUID
    createdAt: datetime
    updatedAt: datetime

    model_config = ORMBaseModel.model_config


class ResourceAllocationResponse(ResourceAllocationInDB):
    """Schema for a resource allocation response."""

    @computed_field  # included in model_dump()/JSON output
    def availableCount(self) -> int:
        """Computed available count."""
        return self.totalCount - self.allocatedCount
