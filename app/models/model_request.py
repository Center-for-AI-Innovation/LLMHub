import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, Date
from sqlalchemy.dialects.postgresql import UUID

from app.repositories.base import Base


class ModelRequest(Base):
    """Model request database model matching the NextJS schema."""
    
    __tablename__ = "ModelRequest"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    userId = Column(UUID(as_uuid=True), nullable=False)
    name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=False)
    department = Column(String(255), nullable=False)
    modelType = Column(String, nullable=False)
    purpose = Column(Text, nullable=False)
    startDate = Column(Date, nullable=False)
    endDate = Column(Date, nullable=False)
    resourceRequirements = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="pending")
    createdAt = Column(DateTime, nullable=False, default=datetime.utcnow)
    updatedAt = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow) 