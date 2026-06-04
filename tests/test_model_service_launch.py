from app.schemas.model_deployment import ModelDeploymentCreate
from app.services.model_service import ModelService


class FakeDbSession:
    def __init__(self):
        self.added = []

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        return None

    def refresh(self, obj):
        return None


class FakeLLMClient:
    def __init__(self):
        self.calls = []

    def launch_model(self, model_name, enable_cloudflare_tunnel=False, cluster_username=None, **params):
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
