from sqlalchemy import Column, String, Integer, JSON, DateTime, func
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()

class AvailableModel(Base):
    """Model for available models."""

    __tablename__ = "AvailableModel"

    id = Column(String(255), primary_key=True)
    name = Column(String(255), nullable=False)
    description = Column(String, nullable=True)
    status = Column(String, default="WARM", nullable=False)
    type = Column(String, nullable=False)
    family = Column(String(100), nullable=False)
    variant = Column(String(100), nullable=False)
    modelType = Column(String(50), nullable=True)
    specs = Column(JSON, nullable=False)
    vocabSize = Column(Integer, nullable=True)
    huggingfaceId = Column(String(255), nullable=True)
    createdAt = Column(DateTime, default=func.now(), nullable=False)
    updatedAt = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)

    def __repr__(self):
        return f"<AvailableModel(id='{self.id}', name='{self.name}', family='{self.family}', variant='{self.variant}')>" 