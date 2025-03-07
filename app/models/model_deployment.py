import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, JSON, Enum
from sqlalchemy.dialects.postgresql import UUID

from app.repositories.base import Base


class ModelDeployment(Base):
    """Model deployment database model."""
    
    __tablename__ = "ModelDeployment"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    modelName = Column(String, nullable=False)
    slurmJobId = Column(String, nullable=False)
    status = Column(
        Enum("pending", "launching", "ready", "failed", "shutdown", name="deployment_status"),
        nullable=False,
        default="pending"
    )
    userId = Column(UUID(as_uuid=True), nullable=False)
    createdAt = Column(DateTime, nullable=False, default=datetime.utcnow)
    updatedAt = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    endpointUrl = Column(String, nullable=True)
    tunnelUrl = Column(String, nullable=True)
    errorMessage = Column(String, nullable=True)
    resourceAllocation = Column(JSON, nullable=True)
    expirationTime = Column(DateTime, nullable=True) 