import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, DateTime, Boolean
from sqlalchemy.dialects.postgresql import UUID

from app.repositories.base import Base


class ResourceAllocation(Base):
    """Resource allocation database model."""
    
    __tablename__ = "ResourceAllocation"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    resourceType = Column(String, nullable=False)  # e.g., "GPU", "CPU", "Memory"
    resourceName = Column(String, nullable=False)  # e.g., "A100", "V100"
    totalCount = Column(Integer, nullable=False)
    allocatedCount = Column(Integer, nullable=False, default=0)
    isActive = Column(Boolean, nullable=False, default=True)
    createdAt = Column(DateTime, nullable=False, default=datetime.utcnow)
    updatedAt = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow) 