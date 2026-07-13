"""Email notification service for deployment lifecycle and access events."""

import uuid
from email.mime.text import MIMEText

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
import aiosmtplib

from app.config.config import settings
from app.config.logging import get_logger
from app.models.email_notification import EmailNotification
from app.models.model_deployment import ModelDeployment
from app.models.user import User


logger = get_logger("email_service")

_READY_SUBJECT = "[LLMHub] Your model {model_name} is ready"
# TODO: Add endpoint url to the body so users can directly access the chat page.
_READY_BODY = """\
Your model deployment is ready and accepting requests.

  Model:      {model_name}
  Expires at: {expires_at}

If you did not request this deployment, please contact your system administrator.
"""

_FAILED_SUBJECT = "[LLMHub] Your model {model_name} deployment failed"
_FAILED_BODY = """\
Your model deployment encountered an error and could not start.

  Model:  {model_name}
  Reason: {error_message}

Please try launching the model again or contact your system administrator if the issue persists.
"""

_COMPLETED_SUBJECT = "[LLMHub] Your model {model_name} deployment has completed"
_COMPLETED_BODY = """\
Your model deployment created has completed its scheduled run and is no longer active.

  Model: {model_name}
  id: {deployment_id}

If you need continued access, please submit a new deployment request.
If you have questions, contact your system administrator.
"""

_INVITE_SUBJECT = "[LLMHub] You have been granted access to {model_name}"
_INVITE_BODY = """\
You have been granted access to a model deployment on LLMHub.

  Model:      {model_name}
  Granted by: {granted_by}
  Status:     {status}

{access_instructions}

If you were not expecting this access, please contact your system administrator.
"""

_INVITE_ACCESS_WITH_URL = (
    "Sign in at {frontend_url} and select {model_name} in the chat interface "
    "to start using it."
)
_INVITE_ACCESS_DEFAULT = (
    "Sign in to LLMHub and select {model_name} in the chat interface "
    "to start using it."
)


class EmailService:
    """Sends deployment notification emails via the campus SMTP relay."""

    async def notify_deployment_ready(
        self,
        db: Session,
        deployment: ModelDeployment,
        user_id: uuid.UUID,
    ) -> bool:
        """Send a notification email when a deployment reaches the ready state.

        Args:
            db: Active database session used to resolve the user email address.
            deployment: The deployment that just became ready.
            user_id: UUID of the authorized user to notify. Callers must look up
                recipients from AuthorizedUsers and fan out one call per user.

        Returns:
            True if the email was delivered successfully, False otherwise.
        """
        recipient = self._resolve_email(db, deployment, user_id)
        if not recipient:
            return False

        expires_at = (
            deployment.expiresAt.strftime("%Y-%m-%d %H:%M UTC")
            if deployment.expiresAt
            else "not set"
        )
        subject = _READY_SUBJECT.format(model_name=deployment.modelName)
        body = _READY_BODY.format(
            model_name=deployment.modelName,
            expires_at=expires_at,
        )
        return await self._send(recipient, subject, body)

    async def notify_deployment_failed(
        self,
        db: Session,
        deployment: ModelDeployment,
        user_id: uuid.UUID,
    ) -> bool:
        """Send a notification email when a deployment fails before becoming ready.

        Args:
            db: Active database session used to resolve the user email address.
            deployment: The deployment that transitioned to failed.
            user_id: UUID of the authorized user to notify. Callers must look up
                recipients from AuthorizedUsers and fan out one call per user.

        Returns:
            True if the email was delivered successfully, False otherwise.
        """
        recipient = self._resolve_email(db, deployment, user_id)
        if not recipient:
            return False

        subject = _FAILED_SUBJECT.format(model_name=deployment.modelName)
        body = _FAILED_BODY.format(
            model_name=deployment.modelName,
            error_message=deployment.errorMessage or "unknown error",
        )
        return await self._send(recipient, subject, body)

    async def notify_deployment_completed(
        self,
        db: Session,
        deployment: ModelDeployment,
        user_id: uuid.UUID,
    ) -> bool:
        """Send a notification email when a deployment ends due to a normal Slurm job timeout.

        Args:
            db: Active database session used to resolve the user email address.
            deployment: The deployment whose Slurm job timed out.
            user_id: UUID of the authorized user to notify. Callers must look up
                recipients from AuthorizedUsers and fan out one call per user.

        Returns:
            True if the email was delivered successfully, False otherwise.
        """
        recipient = self._resolve_email(db, deployment, user_id)
        if not recipient:
            return False
        subject = _COMPLETED_SUBJECT.format(model_name=deployment.modelName,)
        body = _COMPLETED_BODY.format(model_name=deployment.modelName, deployment_id=deployment.id)
        return await self._send(recipient, subject, body)

    async def notify_deployment_invite(
        self,
        db: Session,
        deployment: ModelDeployment,
        user_id: uuid.UUID,
        shared_by_user_id: uuid.UUID | None = None,
    ) -> bool:
        """Send a notification email when a user is granted access to a deployment.

        Args:
            db: Active database session used to resolve user email addresses.
            deployment: The deployment the user was granted access to.
            user_id: UUID of the user who was granted access.
            shared_by_user_id: UUID of the user who granted access, if known.

        Returns:
            True if the email was delivered successfully, False otherwise.
        """
        recipient = self._resolve_email(db, deployment, user_id)
        if not recipient:
            return False

        granted_by = (
            self._describe_user(db, shared_by_user_id) or "another LLMHub user"
        )
        if settings.FRONTEND_URL:
            access_instructions = _INVITE_ACCESS_WITH_URL.format(
                frontend_url=settings.FRONTEND_URL,
                model_name=deployment.modelName,
            )
        else:
            access_instructions = _INVITE_ACCESS_DEFAULT.format(
                model_name=deployment.modelName,
            )

        subject = _INVITE_SUBJECT.format(model_name=deployment.modelName)
        body = _INVITE_BODY.format(
            model_name=deployment.modelName,
            granted_by=granted_by,
            status=deployment.status,
            access_instructions=access_instructions,
        )
        return await self._send(recipient, subject, body)

    async def notify_deployment_invite_once(
        self,
        db: Session,
        deployment: ModelDeployment,
        user_id: uuid.UUID,
        shared_by_user_id: uuid.UUID | None = None,
    ) -> str:
        """Send an access-granted email at most once per (deployment, user).

        Inserts the EmailNotification row and flushes to claim the slot
        atomically via the unique constraint on (deploymentId, userId, type) —
        the same dedup pattern BackgroundService uses for lifecycle emails —
        so retried share requests never produce duplicate emails.

        Args:
            db: Active database session; committed after the send attempt.
            deployment: The deployment the user was granted access to.
            user_id: UUID of the user who was granted access.
            shared_by_user_id: UUID of the user who granted access, if known.

        Returns:
            "sent" on successful delivery, "failed" if SMTP delivery failed
            (recorded, not retried), or "duplicate" if a notification was
            already attempted for this (deployment, user) pair.
        """
        notification = EmailNotification(
            deploymentId=deployment.id,
            userId=user_id,
            type="invite",
            status="pending",
        )
        db.add(notification)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()  # another request already claimed this slot
            return "duplicate"

        delivered = await self.notify_deployment_invite(
            db, deployment, user_id, shared_by_user_id
        )
        notification.status = "sent" if delivered else "failed"
        db.commit()
        return notification.status

    def _resolve_email(
        self,
        db: Session,
        deployment: ModelDeployment,
        user_id: uuid.UUID,
    ) -> str | None:
        """Look up a user's email address from the shared User table.

        Args:
            db: Active database session.
            deployment: Deployment context used for logging only.
            user_id: UUID of the user whose email address to look up.

        Returns:
            Email address string, or None if not found.
        """
        try:
            user = db.query(User).filter(User.id == user_id).first()
            if not user:
                logger.warning(
                    "No user found for userId=%s (deployment id=%s) — skipping email",
                    user_id,
                    deployment.id,
                )
                return None
            return user.email
        except Exception:
            logger.exception(
                "Failed to resolve email for userId=%s (deployment id=%s)",
                user_id,
                deployment.id,
            )
            return None

    def _describe_user(
        self,
        db: Session,
        user_id: uuid.UUID | None,
    ) -> str | None:
        """Format a user as "Name (email)" for use in email bodies.

        Args:
            db: Active database session.
            user_id: UUID of the user to describe, or None.

        Returns:
            "Name (email)" (or just the email if the name is empty), or None
            when user_id is None, the user does not exist, or the lookup
            fails — callers substitute a generic description.
        """
        if user_id is None:
            return None
        try:
            user = db.query(User).filter(User.id == user_id).first()
            if not user:
                return None
            if user.name:
                return f"{user.name} ({user.email})"
            return user.email
        except Exception:
            logger.exception("Failed to resolve user %s for email body", user_id)
            return None

    async def _send(self, recipient: str, subject: str, body: str) -> bool:
        """Deliver a plain-text email via the campus SMTP relay.

        The relay authenticates by source IP; no credentials are required.

        Args:
            recipient: Destination email address.
            subject: Email subject line.
            body: Plain-text email body.

        Returns:
            True if the message was accepted by the relay, False on any error.
            Exceptions are never re-raised so that a transient SMTP failure
            cannot crash the sync loop; the caller must check the return value
            to decide whether to record a successful notification.
        """
        msg = MIMEText(body)
        msg["Subject"] = subject.replace("\r", " ").replace("\n", " ")
        msg["From"] = settings.SMTP_FROM.replace("\r", " ").replace("\n", " ")
        msg["To"] = recipient.replace("\r", " ").replace("\n", " ")

        try:
            await aiosmtplib.send(
                msg,
                hostname=settings.SMTP_HOST,
                port=settings.SMTP_PORT,
                start_tls=False,   # port 25 relay, no TLS
                timeout=20,
            )
            logger.info(
                "Sent notification email to=%s subject=%r", recipient, subject
            )
            return True
        except Exception:
            logger.exception(
                "Failed to send notification email to=%s subject=%r", recipient, subject
            )
            return False
