from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.schemas._base import ORMBaseModel


class ModelSpecs(BaseModel):
    """Model specifications."""

    gpus: int
    nodes: int
    contextLength: int
    parallelism: bool


class AvailableModelBase(BaseModel):
    """Base schema for available models."""

    id: str
    name: str
    description: Optional[str] = None
    status: str = "WARM"
    type: str
    family: str
    variant: str
    modelType: Optional[str] = None
    specs: ModelSpecs
    vocabSize: Optional[int] = None
    huggingfaceId: Optional[str] = None


class AvailableModelCreate(AvailableModelBase):
    """Schema for creating an available model."""

    pass


class AvailableModelUpdate(BaseModel):
    """Schema for updating an available model."""

    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    type: Optional[str] = None
    family: Optional[str] = None
    variant: Optional[str] = None
    modelType: Optional[str] = None
    specs: Optional[ModelSpecs] = None
    vocabSize: Optional[int] = None
    huggingfaceId: Optional[str] = None


class AvailableModelResponse(AvailableModelBase):
    """Schema for available model response."""

    createdAt: datetime
    updatedAt: datetime

    model_config = ORMBaseModel.model_config
