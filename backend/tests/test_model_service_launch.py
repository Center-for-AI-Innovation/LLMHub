from app.models.available_model import AvailableModel
from app.schemas.model_deployment import ModelDeploymentCreate
from app.services.model_service import ModelService


class FakeQuery:
    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return None


class FakeDbSession:
    def __init__(self):
        self.added = []

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        return None

    def refresh(self, obj):
        return None

    def query(self, *args, **kwargs):
        return FakeQuery()


class FakeLLMClient:
    def __init__(self):
        self.calls = []

    def launch_model(
        self,
        model_name,
        enable_cloudflare_tunnel=False,
        cluster_username=None,
        **params,
    ):
        self.calls.append(
            {
                "model_name": model_name,
                "enable_cloudflare_tunnel": enable_cloudflare_tunnel,
                "cluster_username": cluster_username,
                "params": params,
            }
        )
        return {"success": True, "job_id": "12345", "slurm_job_id": "12345"}


def test_launch_model_persists_cluster_username():
    db = FakeDbSession()
    service = ModelService()
    fake_llm_client = FakeLLMClient()
    service.llm_client = fake_llm_client

    deployment = ModelDeploymentCreate(
        modelName="Qwen/Qwen3-8B",
        modelId="Qwen/Qwen3-8B",
        userId="11111111-1111-1111-1111-111111111111",
        clusterUsername="alice",
        partition="gpuA40x4",
    )

    result = service.launch_model(db=db, deployment=deployment)

    assert fake_llm_client.calls[0]["cluster_username"] == "alice"
    assert db.added[0].resourceAllocation["cluster_username"] == "alice"
    assert result.slurmJobId == "12345"


class FakeGatedDbSession(FakeDbSession):
    """Like FakeDbSession, but `query().first()` returns a preset model."""

    def __init__(self, model):
        super().__init__()
        self._model = model

    def query(self, *args, **kwargs):
        model = self._model

        class _Query:
            def filter(self, *a, **k):
                return self

            def first(self):
                return model

        return _Query()


def test_launch_model_scopes_gated_weights_to_cluster_user(monkeypatch):
    gated_model = AvailableModel(
        id="Qwen/Qwen3-8B", huggingfaceId="Qwen/Qwen3-8B", gated="manual"
    )
    db = FakeGatedDbSession(gated_model)
    service = ModelService()
    fake_llm_client = FakeLLMClient()
    service.llm_client = fake_llm_client

    monkeypatch.setattr(
        "app.services.model_service.check_model_hf_access",
        lambda *a, **k: (True, None),
    )
    monkeypatch.setattr(
        "app.services.model_service.ensure_gated_model_weights_for_user",
        lambda cluster_username, model_name: f"/workspace/{cluster_username}/model-weights",
    )

    deployment = ModelDeploymentCreate(
        modelName="Qwen/Qwen3-8B",
        modelId="Qwen/Qwen3-8B",
        userId="11111111-1111-1111-1111-111111111111",
        clusterUsername="alice",
        hf_token="valid-token",
    )

    result = service.launch_model(db=db, deployment=deployment)

    assert result.status == "pending"
    assert (
        fake_llm_client.calls[0]["params"]["model_weights_parent_dir"]
        == "/workspace/alice/model-weights"
    )


def test_launch_model_gated_weights_failure_fails_deployment(monkeypatch):
    gated_model = AvailableModel(
        id="Qwen/Qwen3-8B", huggingfaceId="Qwen/Qwen3-8B", gated="manual"
    )
    db = FakeGatedDbSession(gated_model)
    service = ModelService()
    service.llm_client = FakeLLMClient()

    monkeypatch.setattr(
        "app.services.model_service.check_model_hf_access",
        lambda *a, **k: (True, None),
    )

    def _boom(cluster_username, model_name):
        raise RuntimeError("model not found in the shared model store")

    monkeypatch.setattr(
        "app.services.model_service.ensure_gated_model_weights_for_user", _boom
    )

    deployment = ModelDeploymentCreate(
        modelName="Qwen/Qwen3-8B",
        modelId="Qwen/Qwen3-8B",
        userId="11111111-1111-1111-1111-111111111111",
        clusterUsername="alice",
        hf_token="valid-token",
    )

    result = service.launch_model(db=db, deployment=deployment)

    assert result.status == "failed"
    assert "Failed to prepare gated model weights" in result.errorMessage


def test_deployment_create_trims_cluster_username():
    deployment = ModelDeploymentCreate(
        modelName="Qwen/Qwen3-8B",
        userId="11111111-1111-1111-1111-111111111111",
        clusterUsername=" alice_13 ",
    )

    assert deployment.cluster_username == "alice_13"


def test_deployment_create_rejects_invalid_cluster_username():
    try:
        ModelDeploymentCreate(
            modelName="Qwen/Qwen3-8B",
            userId="11111111-1111-1111-1111-111111111111",
            clusterUsername="../alice",
        )
    except ValueError as exc:
        assert "clusterUsername must be a valid cluster login name" in str(exc)
    else:
        raise AssertionError("Expected invalid clusterUsername to be rejected")
