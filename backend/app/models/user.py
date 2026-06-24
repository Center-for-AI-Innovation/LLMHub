"""Read-only SQLAlchemy mapping for the User table.

This table is owned and migrated exclusively by the frontend (Drizzle). The
backend must never issue DDL against it (no create_all, no Alembic migration).
This class exists solely so the ORM can build type-safe queries against it.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.repositories.base import Base


class User(Base):
    """Mirrors the 'User' table defined in the frontend Drizzle schema."""

    __tablename__ = "User"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    email = Column(String(255), nullable=False)
    emailVerified = Column(Boolean, nullable=False, default=False)
    image = Column(String, nullable=True)
    createdAt = Column(DateTime, nullable=False, default=datetime.utcnow)
    updatedAt = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    apiKeyHash = Column(String, nullable=True)
    apiKeyExpiresAt = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("email", name="User_email_key"),
    )
