from unittest.mock import MagicMock, patch
from uuid import uuid4

from app.models.available_model import AvailableModel
from app.models.model_deployment import ModelDeployment
from app.schemas.model_deployment import ModelDeploymentCreate
from app.services.model_service import ModelService


def test_launch_model_gated_no_token_fails_fast():
    """
    Test that launching a gated model (which exists in DB) without a token
    fails immediately before any resource allocation.
    """
    service = ModelService()
    db = MagicMock()

    # 1. Setup a mocked gated model in DB
    model_id = "gated-model-id"
    mock_model = AvailableModel(
        id=model_id, huggingfaceId="org/gated-model", gated="manual"
    )
    db.query.return_value.filter.return_value.first.return_value = mock_model

    # 2. Prepare deployment request without hf_token
    deployment_data = ModelDeploymentCreate(
        modelId=model_id,
        modelName="Gated Model",
        userId=uuid4(),
        num_gpus=1,
        resource_type="l40s",
    )

    # 3. Mock check_model_hf_access to return Failure (as it should for gated + no token)
    # We also mock ResourceService to ensure it's NOT called
    with (
        patch("app.services.model_service.check_model_hf_access") as mock_check,
        patch("app.services.model_service.ResourceService") as mock_resource_service,
    ):

        mock_check.return_value = (False, "Missing hf_token for gated model")

        result = service.launch_model(db, deployment_data)

        # Verify result is a failed deployment
        assert isinstance(result, ModelDeployment)
        assert result.status == "failed"
        assert "Hugging Face model access denied" in result.errorMessage
        assert "Missing hf_token" in result.errorMessage

        # Verify DB interactions
        db.add.assert_called_once()
        db.commit.assert_called_once()

        # CRITICAL: Verify resources were NEVER allocated (Fast Exit)
        mock_resource_service.return_value.allocate_resources.assert_not_called()


def test_launch_model_gated_invalid_token_fails_fast():
    """
    Test that launching a gated model with an invalid token
    fails immediately after HF API check.
    """
    service = ModelService()
    db = MagicMock()

    model_id = "gated-model-id"
    mock_model = AvailableModel(
        id=model_id, huggingfaceId="org/gated-model", gated="auto"
    )
    db.query.return_value.filter.return_value.first.return_value = mock_model

    deployment_data = ModelDeploymentCreate(
        modelId=model_id, modelName="Gated Model", userId=uuid4(), hf_token="bad-token"
    )

    with (
        patch("app.services.model_service.check_model_hf_access") as mock_check,
        patch("app.services.model_service.ResourceService") as mock_resource_service,
    ):

        mock_check.return_value = (False, "Invalid token")

        result = service.launch_model(db, deployment_data)

        assert result.status == "failed"
        assert "Invalid token" in result.errorMessage
        mock_resource_service.return_value.allocate_resources.assert_not_called()


def test_launch_model_gated_valid_token_proceeds():
    """
    Test that launching a gated model with a valid token
    passes the HF check and proceeds to resource allocation and launch.
    """
    service = ModelService()
    service.llm_client = MagicMock()
    service.llm_client.launch_model.return_value = {
        "success": True,
        "job_id": "job-123",
    }
    db = MagicMock()

    model_id = "gated-model-id"
    mock_model = AvailableModel(
        id=model_id, huggingfaceId="org/gated-model", gated="auto"
    )
    db.query.return_value.filter.return_value.first.return_value = mock_model

    deployment_data = ModelDeploymentCreate(
        modelId=model_id,
        modelName="Gated Model",
        userId=uuid4(),
        hf_token="valid-token",
        num_gpus=1,
        num_nodes=1,
    )

    with (
        patch("app.services.model_service.check_model_hf_access") as mock_check,
        patch("app.services.model_service.ResourceService") as mock_resource_service,
    ):

        mock_check.return_value = (True, None)
        # Mock resource allocation success
        mock_resource_service.return_value.allocate_resources.return_value = {
            "success": True
        }

        result = service.launch_model(db, deployment_data)

        assert result.status == "pending"
        assert result.slurmJobId == "job-123"

        # Verify HF check was called
        mock_check.assert_called_once()
        # Verify it PROCEEDED to resource allocation
        mock_resource_service.return_value.allocate_resources.assert_called_once()


def test_process_model_keeps_cached_gated_on_fetch_failure():
    """A transient HF API failure on a known model keeps its cached status."""
    service = ModelService()
    existing_model = AvailableModel(
        id="org/model", huggingfaceId="org/model", gated="manual"
    )

    with patch("app.services.model_service.fetch_model_gating_status") as mock_fetch:
        mock_fetch.side_effect = Exception("network error")
        result = service._process_model(
            {"model_name": "org/model", "huggingface_id": "org/model"},
            existing_model=existing_model,
        )

    assert result["attrs"]["gated"] == "manual"


def test_process_model_fails_closed_on_fetch_failure_for_new_model():
    """A transient HF API failure on a brand-new model must not default to
    public -- that would silently skip authorization for a model that could
    actually be gated."""
    service = ModelService()

    with patch("app.services.model_service.fetch_model_gating_status") as mock_fetch:
        mock_fetch.side_effect = Exception("network error")
        result = service._process_model(
            {"model_name": "org/new-model", "huggingface_id": "org/new-model"},
            existing_model=None,
        )

    assert result["attrs"]["gated"] == "unknown"


def test_process_model_clears_stale_gated_status_when_now_public():
    """A real gated-to-public transition must actually clear the cache,
    not be masked by treating every None as "keep the cached value"."""
    service = ModelService()
    existing_model = AvailableModel(
        id="org/model", huggingfaceId="org/model", gated="manual"
    )

    with patch("app.services.model_service.fetch_model_gating_status") as mock_fetch:
        mock_fetch.return_value = None  # confirmed public, not a lookup failure
        result = service._process_model(
            {"model_name": "org/model", "huggingface_id": "org/model"},
            existing_model=existing_model,
        )

    assert result["attrs"]["gated"] is None
