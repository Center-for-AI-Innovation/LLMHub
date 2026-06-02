"""EmailNotification database model."""

import uuid

from sqlalchemy import Column, String, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.repositories.base import Base


class EmailNotification(Base):
    """Records a single email notification attempt for a deployment lifecycle event.

    One row is inserted per (deploymentId, userId, type) triplet exactly once, regardless of
    whether the SMTP delivery succeeded. The existence of a row means "we already
    attempted this notification"; userId records the user who received the notification;
    type records the notification type; status records the outcome.
    """

    __tablename__ = "EmailNotification"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    deploymentId = Column(
        UUID(as_uuid=True),
        ForeignKey("ModelDeployment.id", ondelete="CASCADE"),
        nullable=False,
    )
    userId = Column(UUID(as_uuid=True), nullable=False)
    type = Column(String, nullable=False)    # "ready" | "failed" | "completed"
    status = Column(String, nullable=False)  # "sent"  | "failed"

    __table_args__ = (
        # Also creates an index on the deploymentId, userId, and type columns
        UniqueConstraint(
            "deploymentId", "userId", "type",
            name="uq_emailnotification_deployment_userid_type",
        ),
    )
