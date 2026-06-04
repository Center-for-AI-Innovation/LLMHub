import json
from types import SimpleNamespace

from app.config.config import settings
from app.utils import llm_inference


class FakeDirectClient:
    def __init__(self):
        self.slurm_log_dir = None
        self.slurm_account = None

    def launch_model(self, model_name, enable_cloudflare_tunnel=False, **params):
        return {
            "success": True,
            "model_name": model_name,
            "enable_cloudflare_tunnel": enable_cloudflare_tunnel,
            "params": params,
        }

    def get_model_status(self, slurm_job_id):
        return {"success": True, "status": "READY", "job_id": slurm_job_id}

    def get_model_metrics(self, slurm_job_id):
        return {"success": True, "job_id": slurm_job_id}

    def shutdown_model(self, slurm_job_id):
        return {"success": True, "job_id": slurm_job_id}

    def list_available_models(self):
        return {"success": True, "models": []}

    def get_model_details(self, model_name):
        return {"success": True, "details": {"model_name": model_name}}

    def get_tunnel_url(self, job_name, slurm_job_id):
        return None


def test_select_user_slurm_account_prefers_gpu(monkeypatch):
    def fake_run(command, **kwargs):
        assert command == [settings.VEC_INF_ACCOUNTS_SCRIPT, "-u", "alice"]
        return SimpleNamespace(
            returncode=0,
            stdout=(
                "Project Summary for User 'alice':\n\n"
                "Account                        Balance(Hours)   Deposited(Hours)  Project\n"
                "----------------------------  ----------------  ----------------  ----------------------\n"
                "proj-delta-cpu                           10000             10000  test\n"
                "proj-delta-gpu                            1000              1000  test\n"
            ),
            stderr="",
        )

    monkeypatch.setattr(llm_inference.subprocess, "run", fake_run)
    monkeypatch.setattr(settings, "VEC_INF_ACCOUNTS_SCRIPT", "/sw/user/scripts/accounts")

    assert llm_inference._select_user_slurm_account("alice") == "proj-delta-gpu"


def test_normalize_cluster_username_rejects_path_traversal():
    try:
        llm_inference._normalize_cluster_username("../alice")
    except RuntimeError as exc:
        assert "Invalid cluster username" in str(exc)
    else:
        raise AssertionError("Expected invalid cluster username to be rejected")


def test_normalize_cluster_username_accepts_trimmed_login():
    assert llm_inference._normalize_cluster_username(" alice_13 ") == "alice_13"


def test_launch_model_uses_direct_mode(monkeypatch):
    monkeypatch.setattr(llm_inference, "LLMInferenceDirectClient", FakeDirectClient)
    monkeypatch.setattr(settings, "VEC_INF_EXECUTION_MODE", "direct")

    client = llm_inference.LLMInferenceClient()
    result = client.launch_model("Qwen/Qwen3-8B", cluster_username=None, num_gpus=2)

    assert result["success"] is True
    assert result["model_name"] == "Qwen/Qwen3-8B"
    assert result["params"]["num_gpus"] == 2


def test_launch_model_requires_cluster_username_when_impersonating(monkeypatch):
    monkeypatch.setattr(llm_inference, "LLMInferenceDirectClient", FakeDirectClient)
    monkeypatch.setattr(settings, "VEC_INF_EXECUTION_MODE", "impersonate")
    monkeypatch.setattr(settings, "VEC_INF_IMPERSONATE_SCRIPT", "/tmp/impersonate-wrapper")

    client = llm_inference.LLMInferenceClient()
    result = client.launch_model("Qwen/Qwen3-8B", cluster_username=None)

    assert result == {
        "success": False,
        "error": "Cluster username is required when impersonation mode is enabled",
    }


def test_launch_model_runs_impersonated_subprocess(monkeypatch, tmp_path):
    captured = {}
    wrapper_path = tmp_path / "impersonate-wrapper"
    wrapper_path.write_text("#!/bin/sh\nexit 0\n")
    wrapper_path.chmod(0o755)

    def fake_run(command, **kwargs):
        captured["command"] = command
        captured["kwargs"] = kwargs
        return SimpleNamespace(
            returncode=0,
            stdout='{"success": true, "job_id": "12345", "slurm_job_id": "12345"}',
            stderr="",
        )

    monkeypatch.setattr(llm_inference, "LLMInferenceDirectClient", FakeDirectClient)
    monkeypatch.setattr(settings, "VEC_INF_EXECUTION_MODE", "impersonate")
    monkeypatch.setattr(settings, "VEC_INF_IMPERSONATE_SCRIPT", str(wrapper_path))
    monkeypatch.setattr(llm_inference, "_ensure_impersonated_workspace_dir", lambda _: tmp_path / "alice")
    monkeypatch.setattr(llm_inference, "_select_user_slurm_account", lambda *_args, **_kwargs: "bgns-delta-gpu")
    monkeypatch.setattr(llm_inference.subprocess, "run", fake_run)

    client = llm_inference.LLMInferenceClient()
    result = client.launch_model(
        "Qwen/Qwen3-8B",
        cluster_username="alice",
        num_gpus=2,
    )

    payload = json.loads(captured["command"][-1])

    assert result["success"] is True
    assert captured["command"][:4] == [str(wrapper_path), "alice", "--", llm_inference.sys.executable]
    assert captured["command"][4:6] == ["-m", "app.utils.vec_inf_launch_shim"]
    assert captured["kwargs"]["cwd"] == str(llm_inference.PROJECT_ROOT)
    assert captured["kwargs"]["env"]["VEC_INF_ACCOUNT"] == "bgns-delta-gpu"
    assert captured["kwargs"]["env"]["SLURM_ACCOUNT"] == "bgns-delta-gpu"
    assert captured["kwargs"]["env"]["VEC_INF_LOG_DIR"].endswith("/alice")
    assert payload["params"]["work_dir"].endswith("/alice")
    assert payload["params"]["log_dir"].endswith("/alice")


def test_parse_impersonated_response_handles_pty_noise():
    stdout = (
        "2026-04-28 INFO starting\n"
        '\x1b[0m{"success": false, "error": "sbatch failed"}\r\n'
    )

    result = llm_inference.LLMInferenceClient._parse_impersonated_response(stdout, "")

    assert result == {"success": False, "error": "sbatch failed"}
