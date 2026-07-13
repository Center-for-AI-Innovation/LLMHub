"""Unit tests for EmailService. SMTP delivery is mocked; no relay is contacted."""

import uuid
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.exc import IntegrityError

from app.services.email_service import EmailService


pytestmark = pytest.mark.asyncio

MODEL_NAME = "llama-3-8b"


def make_deployment(**overrides):
    """Build a stand-in deployment with the attributes EmailService reads."""
    fields = {
        "id": uuid.uuid4(),
        "modelName": MODEL_NAME,
        "status": "ready",
        "errorMessage": None,
        "expiresAt": None,
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


def make_user(name="Test User", email="user@illinois.edu"):
    return SimpleNamespace(id=uuid.uuid4(), name=name, email=email)


def make_db(*first_results):
    """Mock Session whose successive query(...).filter(...).first() calls
    return first_results in order."""
    db = MagicMock()
    db.query.return_value.filter.return_value.first.side_effect = list(first_results)
    return db


def sent_message(mock_send):
    """Return the MIMEText message passed to the mocked aiosmtplib.send."""
    assert mock_send.await_count == 1
    return mock_send.await_args.args[0]


def patch_send(**kwargs):
    return patch(
        "app.services.email_service.aiosmtplib.send",
        new_callable=AsyncMock,
        **kwargs,
    )


class TestNotifyDeploymentReady:
    async def test_sends_email_with_model_name_and_expiry(self):
        deployment = make_deployment(expiresAt=datetime(2026, 1, 2, 3, 4))
        user = make_user()
        with patch_send() as mock_send:
            delivered = await EmailService().notify_deployment_ready(
                make_db(user), deployment, user.id
            )

        assert delivered is True
        msg = sent_message(mock_send)
        assert msg["To"] == user.email
        assert MODEL_NAME in msg["Subject"]
        assert "is ready" in msg["Subject"]
        body = msg.get_payload()
        assert MODEL_NAME in body
        assert "2026-01-02 03:04 UTC" in body

    async def test_missing_expiry_renders_not_set(self):
        user = make_user()
        with patch_send() as mock_send:
            delivered = await EmailService().notify_deployment_ready(
                make_db(user), make_deployment(expiresAt=None), user.id
            )

        assert delivered is True
        assert "not set" in sent_message(mock_send).get_payload()

    async def test_unknown_user_returns_false_without_sending(self):
        with patch_send() as mock_send:
            delivered = await EmailService().notify_deployment_ready(
                make_db(None), make_deployment(), uuid.uuid4()
            )

        assert delivered is False
        mock_send.assert_not_awaited()

    async def test_smtp_error_returns_false(self):
        user = make_user()
        with patch_send(side_effect=Exception("relay down")):
            delivered = await EmailService().notify_deployment_ready(
                make_db(user), make_deployment(), user.id
            )

        assert delivered is False


class TestNotifyDeploymentFailed:
    async def test_includes_error_message(self):
        deployment = make_deployment(status="failed", errorMessage="OOM on node gpu-3")
        user = make_user()
        with patch_send() as mock_send:
            delivered = await EmailService().notify_deployment_failed(
                make_db(user), deployment, user.id
            )

        assert delivered is True
        msg = sent_message(mock_send)
        assert MODEL_NAME in msg["Subject"]
        assert "failed" in msg["Subject"]
        assert "OOM on node gpu-3" in msg.get_payload()

    async def test_missing_error_message_defaults_to_unknown(self):
        deployment = make_deployment(status="failed", errorMessage=None)
        user = make_user()
        with patch_send() as mock_send:
            await EmailService().notify_deployment_failed(
                make_db(user), deployment, user.id
            )

        assert "unknown error" in sent_message(mock_send).get_payload()


class TestNotifyDeploymentCompleted:
    async def test_includes_deployment_id(self):
        deployment = make_deployment(status="shutdown")
        user = make_user()
        with patch_send() as mock_send:
            delivered = await EmailService().notify_deployment_completed(
                make_db(user), deployment, user.id
            )

        assert delivered is True
        msg = sent_message(mock_send)
        assert MODEL_NAME in msg["Subject"]
        assert "completed" in msg["Subject"]
        assert str(deployment.id) in msg.get_payload()


class TestNotifyDeploymentInvite:
    async def test_includes_model_sharer_and_status(self):
        deployment = make_deployment(status="ready")
        recipient = make_user(name="Invitee", email="invitee@illinois.edu")
        sharer = make_user(name="Owner", email="owner@illinois.edu")
        # _resolve_email looks up the recipient first, then _describe_user the sharer
        db = make_db(recipient, sharer)

        with patch_send() as mock_send:
            delivered = await EmailService().notify_deployment_invite(
                db, deployment, recipient.id, sharer.id
            )

        assert delivered is True
        msg = sent_message(mock_send)
        assert msg["To"] == recipient.email
        assert msg["Subject"] == f"[LLMHub] You have been granted access to {MODEL_NAME}"
        body = msg.get_payload()
        assert MODEL_NAME in body
        assert "Owner (owner@illinois.edu)" in body
        assert "ready" in body
        assert "contact your system administrator" in body

    async def test_without_sharer_uses_generic_description(self):
        recipient = make_user()
        with patch_send() as mock_send:
            delivered = await EmailService().notify_deployment_invite(
                make_db(recipient), make_deployment(), recipient.id
            )

        assert delivered is True
        assert "another LLMHub user" in sent_message(mock_send).get_payload()

    async def test_missing_sharer_row_still_sends(self):
        recipient = make_user()
        db = make_db(recipient, None)  # sharer lookup finds no row
        with patch_send() as mock_send:
            delivered = await EmailService().notify_deployment_invite(
                db, make_deployment(), recipient.id, uuid.uuid4()
            )

        assert delivered is True
        assert "another LLMHub user" in sent_message(mock_send).get_payload()

    async def test_unknown_recipient_returns_false_without_sending(self):
        with patch_send() as mock_send:
            delivered = await EmailService().notify_deployment_invite(
                make_db(None), make_deployment(), uuid.uuid4()
            )

        assert delivered is False
        mock_send.assert_not_awaited()

    async def test_frontend_url_included_when_configured(self):
        recipient = make_user()
        with patch_send() as mock_send, patch(
            "app.services.email_service.settings.FRONTEND_URL",
            "https://llmhub.example.edu",
        ):
            await EmailService().notify_deployment_invite(
                make_db(recipient), make_deployment(), recipient.id
            )

        assert "https://llmhub.example.edu" in sent_message(mock_send).get_payload()


class TestNotifyDeploymentInviteOnce:
    async def test_sends_and_records_sent(self):
        deployment = make_deployment()
        recipient = make_user()
        db = make_db(recipient)

        with patch_send() as mock_send:
            result = await EmailService().notify_deployment_invite_once(
                db, deployment, recipient.id
            )

        assert result == "sent"
        mock_send.assert_awaited_once()
        db.flush.assert_called_once()
        db.commit.assert_called_once()
        notification = db.add.call_args.args[0]
        assert notification.deploymentId == deployment.id
        assert notification.userId == recipient.id
        assert notification.type == "invite"
        assert notification.status == "sent"

    async def test_duplicate_claim_skips_send(self):
        db = make_db()
        db.flush.side_effect = IntegrityError("stmt", {}, Exception("duplicate"))

        with patch_send() as mock_send:
            result = await EmailService().notify_deployment_invite_once(
                db, make_deployment(), uuid.uuid4()
            )

        assert result == "duplicate"
        mock_send.assert_not_awaited()
        db.rollback.assert_called_once()
        db.commit.assert_not_called()

    async def test_smtp_failure_recorded_as_failed(self):
        recipient = make_user()
        db = make_db(recipient)

        with patch_send(side_effect=Exception("relay down")):
            result = await EmailService().notify_deployment_invite_once(
                db, make_deployment(), recipient.id
            )

        assert result == "failed"
        db.commit.assert_called_once()
        assert db.add.call_args.args[0].status == "failed"


class TestSendHeaderSanitization:
    async def test_newlines_stripped_from_headers(self):
        with patch_send() as mock_send:
            delivered = await EmailService()._send(
                "user@illinois.edu", "subject\r\nwith newline", "body"
            )

        assert delivered is True
        msg = sent_message(mock_send)
        assert "\n" not in msg["Subject"]
        assert "\r" not in msg["Subject"]
