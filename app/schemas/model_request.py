from datetime import date, datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field


class ModelRequestBase(BaseModel):
    """Base model request schema."""
    
    name: str
    email: str
    department: str
    modelType: str
    purpose: str
    startDate: date
    endDate: date
    resourceRequirements: Optional[str] = None


class ModelRequestCreate(ModelRequestBase):
    """Schema for creating a model request."""
    
    userId: UUID


class ModelRequestUpdate(BaseModel):
    """Schema for updating a model request."""
    
    status: Optional[str] = None


class ModelRequestInDB(ModelRequestBase):
    """Schema for a model request in the database."""
    
    id: UUID
    userId: UUID
    status: str
    createdAt: datetime
    updatedAt: datetime
    
    class Config:
        orm_mode = True
        from_attributes = True


class ModelRequestResponse(ModelRequestInDB):
    """Schema for a model request response."""
    pass 