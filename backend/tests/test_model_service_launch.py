import pytest
from pydantic import ValidationError

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
    db = FakeGatedDbSession(
        AvailableModel(id="Qwen3-8B", huggingfaceId="Qwen/Qwen3-8B")
    )
    service = ModelService()
    fake_llm_client = FakeLLMClient()
    service.llm_client = fake_llm_client

    deployment = ModelDeploymentCreate(
        modelName="Qwen3-8B",
        modelId="Qwen3-8B",
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
        id="Qwen3-8B", huggingfaceId="Qwen/Qwen3-8B", gated="manual"
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
        modelName="Qwen3-8B",
        modelId="Qwen3-8B",
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
    assert "valid-token" not in (fake_llm_client.calls[0]["params"].get("env") or "")


def test_launch_model_gated_weights_failure_fails_deployment(monkeypatch):
    gated_model = AvailableModel(
        id="Qwen3-8B", huggingfaceId="Qwen/Qwen3-8B", gated="manual"
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
        modelName="Qwen3-8B",
        modelId="Qwen3-8B",
        userId="11111111-1111-1111-1111-111111111111",
        clusterUsername="alice",
        hf_token="valid-token",
    )

    result = service.launch_model(db=db, deployment=deployment)

    assert result.status == "failed"
    assert "Failed to prepare gated model weights" in result.errorMessage


def test_launch_model_scopes_gated_weights_to_protected_store_when_direct(monkeypatch):
    """A gated model launched WITHOUT a cluster_username (direct/shared
    execution) must still avoid the world-readable default cache -- it
    should resolve to the protected MODEL_STORE_ROOT, not fall through to
    the infrastructure default model_weights_parent_dir."""
    gated_model = AvailableModel(
        id="Qwen3-8B", huggingfaceId="Qwen/Qwen3-8B", gated="manual"
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
        "app.services.model_service.resolve_gated_model_store_dir",
        lambda model_name: "/protected/model-store",
    )

    deployment = ModelDeploymentCreate(
        modelName="Qwen3-8B",
        modelId="Qwen3-8B",
        userId="11111111-1111-1111-1111-111111111111",
        hf_token="valid-token",
    )

    result = service.launch_model(db=db, deployment=deployment)

    assert result.status == "pending"
    assert (
        fake_llm_client.calls[0]["params"]["model_weights_parent_dir"]
        == "/protected/model-store"
    )


def test_launch_model_direct_gated_store_failure_fails_deployment(monkeypatch):
    """If the gated model isn't pre-staged in the protected store, a direct
    launch must fail closed rather than silently fall back to the
    world-readable default cache."""
    gated_model = AvailableModel(
        id="Qwen3-8B", huggingfaceId="Qwen/Qwen3-8B", gated="manual"
    )
    db = FakeGatedDbSession(gated_model)
    service = ModelService()
    service.llm_client = FakeLLMClient()

    monkeypatch.setattr(
        "app.services.model_service.check_model_hf_access",
        lambda *a, **k: (True, None),
    )

    def _boom(model_name):
        raise RuntimeError("model not found in the protected model store")

    monkeypatch.setattr(
        "app.services.model_service.resolve_gated_model_store_dir", _boom
    )

    deployment = ModelDeploymentCreate(
        modelName="Qwen3-8B",
        modelId="Qwen3-8B",
        userId="11111111-1111-1111-1111-111111111111",
        hf_token="valid-token",
    )

    result = service.launch_model(db=db, deployment=deployment)

    assert result.status == "failed"
    assert "Failed to prepare gated model weights" in result.errorMessage


def test_deployment_create_trims_cluster_username():
    deployment = ModelDeploymentCreate(
        modelName="Qwen3-8B",
        userId="11111111-1111-1111-1111-111111111111",
        clusterUsername=" alice_13 ",
    )

    assert deployment.cluster_username == "alice_13"


def test_deployment_create_accepts_slurm_account():
    deployment = ModelDeploymentCreate(
        modelName="Qwen3-8B",
        userId="11111111-1111-1111-1111-111111111111",
        account=" bgns-delta-gpu ",
    )

    assert deployment.account == "bgns-delta-gpu"


def test_deployment_create_rejects_invalid_slurm_account():
    try:
        ModelDeploymentCreate(
            modelName="Qwen3-8B",
            userId="11111111-1111-1111-1111-111111111111",
            account="bad account",
        )
    except ValueError as exc:
        assert "account must be a valid Slurm account name" in str(exc)
    else:
        raise AssertionError("Expected invalid account to be rejected")


@pytest.mark.parametrize(
    "field,value",
    [
        ("partition", "gpuA40x4\nid > /tmp/pwned"),
        ("partition", "gpuA40x4 --output=/etc/cron.d/x"),
        ("qos", "normal\r--uid=0"),
        ("time", "00:30:00\x00"),
        ("resource_type", "a100 --account=other"),
        ("data_type", "auto;id"),
        ("modelName", "Qwen 3\r\nBcc: victim@example.com"),
        ("modelId", "Qwen3-8B$(id)"),
        ("modelId", "../../etc"),
        ("modelId", "Qwen3-8B\nid"),
        ("modelId", "Qwen/Qwen3-8B"),
    ],
)
def test_deployment_create_rejects_script_unsafe_values(field, value):
    fields = {
        "modelName": "Qwen3-8B",
        "userId": "11111111-1111-1111-1111-111111111111",
        field: value,
    }
    with pytest.raises(ValidationError, match=field):
        ModelDeploymentCreate(**fields)


def test_deployment_create_checks_defaulted_model_id():
    # With no modelId, modelName is launched, so it gets the modelId rules.
    with pytest.raises(ValidationError, match="modelId"):
        ModelDeploymentCreate(
            modelName="Qwen3-8B;id",
            userId="11111111-1111-1111-1111-111111111111",
        )


def test_deployment_create_allows_display_model_name():
    deployment = ModelDeploymentCreate(
        modelName="Gated Model (8B)",
        modelId="Gated-8B",
        userId="11111111-1111-1111-1111-111111111111",
    )

    assert deployment.modelName == "Gated Model (8B)"


def test_deployment_create_accepts_real_slurm_values():
    deployment = ModelDeploymentCreate(
        modelName="Llama-3.1-8B-Instruct",
        userId="11111111-1111-1111-1111-111111111111",
        partition="gpuA100x4-interactive",
        qos="",
        time="1-00:00:00",
        resource_type="nvidia_a100",
        data_type="bfloat16",
    )

    assert deployment.partition == "gpuA100x4-interactive"
    assert deployment.time == "1-00:00:00"


def test_deployment_create_rejects_invalid_cluster_username():
    try:
        ModelDeploymentCreate(
            modelName="Qwen3-8B",
            userId="11111111-1111-1111-1111-111111111111",
            clusterUsername="../alice",
        )
    except ValueError as exc:
        assert "clusterUsername must be a valid cluster login name" in str(exc)
    else:
        raise AssertionError("Expected invalid clusterUsername to be rejected")


def test_launch_model_ignores_client_launch_inputs():
    model = AvailableModel(id="Qwen3-8B", huggingfaceId="Qwen/Qwen3-8B")
    db = FakeGatedDbSession(model)
    service = ModelService()
    fake_llm_client = FakeLLMClient()
    service.llm_client = fake_llm_client

    deployment = ModelDeploymentCreate(
        modelName="Qwen3-8B",
        modelId="Qwen3-8B",
        userId="11111111-1111-1111-1111-111111111111",
        hf_model="attacker/evil-repo",
        model_weights_parent_dir="/projects/modelcache/restricted",
        work_dir="/projects/modelcache/public/huggingface",
        vllm_args="--tokenizer=/projects/modelcache/restricted/Gated-7B",
    )

    service.launch_model(db=db, deployment=deployment)

    params = fake_llm_client.calls[0]["params"]
    assert params["hf_model"] == "Qwen/Qwen3-8B"
    assert "model_weights_parent_dir" not in params
    assert "work_dir" not in params
    assert "vllm_args" not in params


def test_launch_model_keeps_hf_token_out_of_public_launches():
    model = AvailableModel(id="Qwen3-8B", huggingfaceId="Qwen/Qwen3-8B")
    db = FakeGatedDbSession(model)
    service = ModelService()
    fake_llm_client = FakeLLMClient()
    service.llm_client = fake_llm_client

    deployment = ModelDeploymentCreate(
        modelName="Qwen3-8B",
        modelId="Qwen3-8B",
        userId="11111111-1111-1111-1111-111111111111",
        hf_token="user-token",
    )

    service.launch_model(db=db, deployment=deployment)

    params = fake_llm_client.calls[0]["params"]
    assert "user-token" not in repr(params)


def test_launch_model_runs_the_access_checked_model_id():
    model = AvailableModel(id="Qwen3-8B", huggingfaceId="Qwen/Qwen3-8B")
    db = FakeGatedDbSession(model)
    service = ModelService()
    fake_llm_client = FakeLLMClient()
    service.llm_client = fake_llm_client

    deployment = ModelDeploymentCreate(
        modelName="Gated-7B",
        modelId="Qwen3-8B",
        userId="11111111-1111-1111-1111-111111111111",
    )

    service.launch_model(db=db, deployment=deployment)

    assert fake_llm_client.calls[0]["model_name"] == "Qwen3-8B"


def test_launch_model_gated_missing_from_store_starts_download(monkeypatch):
    gated_model = AvailableModel(
        id="Gated-7B", huggingfaceId="org/gated", gated="manual"
    )
    db = FakeGatedDbSession(gated_model)
    service = ModelService()
    fake_llm_client = FakeLLMClient()
    service.llm_client = fake_llm_client

    monkeypatch.setattr(
        "app.services.model_service.check_model_hf_access",
        lambda *a, **k: (True, None),
    )
    started = []
    monkeypatch.setattr(
        "app.services.model_service.start_gated_model_download",
        lambda *args: started.append(args) or "Downloading gated model weights",
    )

    deployment = ModelDeploymentCreate(
        modelName="Gated-7B",
        modelId="Gated-7B",
        userId="11111111-1111-1111-1111-111111111111",
        clusterUsername="alice",
        hf_token="valid-token",
    )

    result = service.launch_model(db=db, deployment=deployment)

    assert started == [("Gated-7B", "org/gated", "valid-token")]
    assert result.status == "failed"
    assert "Downloading" in result.errorMessage
    assert fake_llm_client.calls == []


def test_tunnel_lookup_uses_the_launched_model_id():
    from datetime import datetime
    from types import SimpleNamespace

    deployment = SimpleNamespace(
        status="launching",
        slurmJobId="12345",
        modelId="Qwen3-8B",
        modelName="Qwen 3 8B",
        createdAt=datetime.utcnow(),
        resourceAllocation={
            "enable_cloudflare_tunnel": True,
            "cluster_username": "alice",
        },
        errorMessage=None,
        endpointUrl=None,
        expiresAt=None,
        proxyUrl=None,
        updatedAt=None,
    )
    looked_up = []

    class FakeStatusClient:
        def get_model_status(self, slurm_job_id):
            return {"success": True, "status": "READY"}

        def get_tunnel_url(self, job_name, slurm_job_id, cluster_username=None):
            looked_up.append((job_name, slurm_job_id, cluster_username))
            return "https://example.trycloudflare.com"

    service = ModelService()
    service.llm_client = FakeStatusClient()
    service.get_deployment = lambda db, deployment_id: deployment

    service.update_deployment_status(FakeDbSession(), "deployment-1")

    assert looked_up == [("Qwen3-8B", "12345", "alice")]
    assert deployment.proxyUrl == "https://example.trycloudflare.com"


def test_launch_model_fails_closed_for_a_model_missing_from_the_catalog():
    """No catalog row means no repo id or gating status to check; vec-inf would
    still launch a gated model from models.yaml, so refuse instead."""
    service = ModelService()
    fake_llm_client = FakeLLMClient()
    service.llm_client = fake_llm_client

    result = service.launch_model(
        db=FakeDbSession(),
        deployment=ModelDeploymentCreate(
            modelName="Gated-7B",
            modelId="Gated-7B",
            userId="11111111-1111-1111-1111-111111111111",
        ),
    )

    assert fake_llm_client.calls == []
    assert result.status == "failed"
    assert "has not been synced" in result.errorMessage


def test_launch_model_survives_num_gpus_without_num_nodes(monkeypatch):
    """model_dump() emits num_nodes=None; num_gpus * None used to raise TypeError."""
    allocated = []

    class _Resources:
        def allocate_resources(self, db, resource_type, resource_name, count):
            allocated.append(count)
            return {"success": True}

        def release_resources(self, **kwargs):
            pass

    monkeypatch.setattr(
        "app.services.model_service.ResourceService", lambda: _Resources()
    )
    service = ModelService()
    service.llm_client = FakeLLMClient()

    result = service.launch_model(
        db=FakeGatedDbSession(
            AvailableModel(id="Qwen3-8B", huggingfaceId="Qwen/Qwen3-8B")
        ),
        deployment=ModelDeploymentCreate(
            modelName="Qwen3-8B",
            modelId="Qwen3-8B",
            userId="11111111-1111-1111-1111-111111111111",
            num_gpus=2,
        ),
    )

    assert allocated == [2]
    assert result.slurmJobId == "12345"
