from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel


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
    
    class Config:
        orm_mode = True
        from_attributes = True


class ResourceAllocationResponse(ResourceAllocationInDB):
    """Schema for a resource allocation response."""
    
    availableCount: int
    
    @classmethod
    def from_orm(cls, obj):
        """Create a response from an ORM object."""
        # Create a standard response
        response = super().from_orm(obj)
        
        # Add computed fields
        response.availableCount = obj.totalCount - obj.allocatedCount
        
        return response 