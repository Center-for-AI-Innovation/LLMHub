"""AuthorizedUsers database model."""

import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.repositories.base import Base


class AuthorizedUsers(Base):
    """Tracks which users have access to a given deployment.

    One row per (deploymentId, userId) pair. The permission field distinguishes
    the original owner ('owner') from users who were granted access later ('user').
    This table is the source of truth for who should receive lifecycle email
    notifications for a deployment.
    """

    __tablename__ = "AuthorizedUsers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    deploymentId = Column(
        UUID(as_uuid=True),
        ForeignKey("ModelDeployment.id"),
        nullable=False,
    )
    userId = Column(UUID(as_uuid=True), ForeignKey("User.id"), nullable=False)
    permission = Column(String, nullable=False, default="owner")  # "owner" | "user"
    updatedAt = Column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        UniqueConstraint(
            "deploymentId", "userId", name="AuthorizedUsers_deploymentId_userId_unique"
        ),
    )
