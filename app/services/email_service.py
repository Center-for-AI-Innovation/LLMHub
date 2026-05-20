"""Email notification service for deployment lifecycle events."""

import smtplib
from email.mime.text import MIMEText
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config.config import settings
from app.config.logging import get_logger
from app.models.model_deployment import ModelDeployment

logger = get_logger("email_service")

_READY_SUBJECT = "[LLM Service] Your model {model_name} is ready"
# TODO: Add endpoint url to the body but not using the DB but using the frontend API endpoint. 
_READY_BODY = """\
Your model deployment is ready and accepting requests.

  Model:      {model_name}
  Expires at: {expires_at}

If you did not request this deployment, please contact your system administrator.
"""

_FAILED_SUBJECT = "[LLM Service] Your model {model_name} deployment failed"
_FAILED_BODY = """\
Your model deployment encountered an error and could not start.

  Model:  {model_name}
  Reason: {error_message}

Please try launching the model again or contact your system administrator if the issue persists.
"""


class EmailService:
    """Sends deployment lifecycle notification emails via the campus SMTP relay."""

    def notify_deployment_ready(self, db: Session, deployment: ModelDeployment) -> None:
        """Send a notification email when a deployment reaches the ready state.

        Args:
            db: Active database session used to resolve the user email address.
            deployment: The deployment that just became ready.
        """
        recipient = self._resolve_email(db, deployment)
        if not recipient:
            return

        expires_at = (
            deployment.expiresAt.strftime("%Y-%m-%d %H:%M UTC")
            if deployment.expiresAt
            else "not set"
        )
        subject = _READY_SUBJECT.format(model_name=deployment.modelName)
        body = _READY_BODY.format(
            model_name=deployment.modelName,
            endpoint_url=deployment.endpointUrl or "unavailable",
            expires_at=expires_at,
        )
        self._send(recipient, subject, body)

    def notify_deployment_failed(self, db: Session, deployment: ModelDeployment) -> None:
        """Send a notification email when a deployment fails before becoming ready.

        Args:
            db: Active database session used to resolve the user email address.
            deployment: The deployment that transitioned to failed.
        """
        recipient = self._resolve_email(db, deployment)
        if not recipient:
            return

        subject = _FAILED_SUBJECT.format(model_name=deployment.modelName)
        body = _FAILED_BODY.format(
            model_name=deployment.modelName,
            error_message=deployment.errorMessage or "unknown error",
        )
        self._send(recipient, subject, body)

    def _resolve_email(self, db: Session, deployment: ModelDeployment) -> Optional[str]:
        """Look up the user email address from the shared User table.

        Args:
            db: Active database session.
            deployment: Deployment whose userId will be used for the lookup.

        Returns:
            Email address string, or None if not found.
        """
        try:
            row = db.execute(
                text('SELECT email FROM "User" WHERE id = :user_id'),
                {"user_id": str(deployment.userId)},
            ).fetchone()
            if not row:
                logger.warning(
                    "No user found for userId=%s (deployment id=%s) — skipping email",
                    deployment.userId,
                    deployment.id,
                )
                return None
            return row[0]
        except Exception:
            logger.exception(
                "Failed to resolve email for userId=%s (deployment id=%s)",
                deployment.userId,
                deployment.id,
            )
            return None

    def _send(self, recipient: str, subject: str, body: str) -> None:
        """Deliver a plain-text email via the campus SMTP relay.

        The relay authenticates by source IP; no credentials are required.

        Args:
            recipient: Destination email address.
            subject: Email subject line.
            body: Plain-text email body.
        """
        msg = MIMEText(body)
        msg["Subject"] = subject
        msg["From"] = settings.SMTP_FROM
        msg["To"] = recipient

        try:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as smtp:
                smtp.sendmail(settings.SMTP_FROM, recipient, msg.as_string())
            # TODO: remove after verifying email delivery end-to-end
            print(f"[EmailService] Email sent successfully to={recipient!r} subject={subject!r}", flush=True)
            logger.info(
                "Sent notification email to=%s subject=%r", recipient, subject
            )
        except Exception:
            # Never let an email failure propagate — it must not crash the sync loop.
            logger.exception(
                "Failed to send notification email to=%s subject=%r", recipient, subject
            )
