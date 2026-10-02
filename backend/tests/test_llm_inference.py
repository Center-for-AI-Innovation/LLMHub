import json
from pathlib import Path
from types import SimpleNamespace

from app.config.config import VecInfExecutionMode, settings
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


def test_launch_model_uses_direct_mode(monkeypatch):
    monkeypatch.setattr(llm_inference, "LLMInferenceDirectClient", FakeDirectClient)
    monkeypatch.setattr(settings, "VEC_INF_EXECUTION_MODE", VecInfExecutionMode.DIRECT)

    client = llm_inference.LLMInferenceClient()
    result = client.launch_model("Qwen/Qwen3-8B", cluster_username=None, num_gpus=2)

    assert result["success"] is True
    assert result["model_name"] == "Qwen/Qwen3-8B"
    assert result["params"]["num_gpus"] == 2


def test_launch_model_requires_cluster_username_when_impersonating(monkeypatch):
    monkeypatch.setattr(llm_inference, "LLMInferenceDirectClient", FakeDirectClient)
    monkeypatch.setattr(
        settings, "VEC_INF_EXECUTION_MODE", VecInfExecutionMode.IMPERSONATE
    )
    monkeypatch.setattr(
        settings, "VEC_INF_IMPERSONATE_SCRIPT", "/tmp/impersonate-wrapper"
    )

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
    monkeypatch.setattr(
        settings, "VEC_INF_EXECUTION_MODE", VecInfExecutionMode.IMPERSONATE
    )
    monkeypatch.setattr(settings, "VEC_INF_IMPERSONATE_SCRIPT", str(wrapper_path))
    monkeypatch.setattr(
        llm_inference,
        "_ensure_impersonated_workspace_dir",
        lambda _: tmp_path / "alice",
    )
    monkeypatch.setattr(
        llm_inference, "_ensure_shared_cache_dir_access", lambda _username: None
    )
    monkeypatch.setattr(
        llm_inference,
        "_select_user_slurm_account",
        lambda *_args, **_kwargs: "bgns-delta-gpu",
    )
    monkeypatch.setattr(llm_inference.subprocess, "run", fake_run)

    client = llm_inference.LLMInferenceClient()
    result = client.launch_model(
        "Qwen/Qwen3-8B",
        cluster_username="alice",
        num_gpus=2,
    )

    payload = json.loads(captured["command"][-1])

    assert result["success"] is True
    assert captured["command"][:5] == [
        str(wrapper_path),
        "--no-login-shell",
        "alice",
        "--",
        llm_inference._get_impersonation_python(),
    ]
    assert captured["command"][5:7] == ["-m", "app.utils.vec_inf_launch_shim"]
    assert captured["kwargs"]["cwd"] == str(tmp_path / "alice")
    assert captured["kwargs"]["env"]["VEC_INF_ACCOUNT"] == "bgns-delta-gpu"
    assert captured["kwargs"]["env"]["SLURM_ACCOUNT"] == "bgns-delta-gpu"
    assert captured["kwargs"]["env"]["VEC_INF_LOG_DIR"].endswith("/alice")
    assert payload["params"]["work_dir"].endswith("/alice")
    assert payload["params"]["log_dir"].endswith("/alice")


def test_launch_model_uses_provided_slurm_account(monkeypatch, tmp_path):
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
    monkeypatch.setattr(
        settings, "VEC_INF_EXECUTION_MODE", VecInfExecutionMode.IMPERSONATE
    )
    monkeypatch.setattr(settings, "VEC_INF_IMPERSONATE_SCRIPT", str(wrapper_path))
    monkeypatch.setattr(
        llm_inference,
        "_ensure_impersonated_workspace_dir",
        lambda _: tmp_path / "alice",
    )
    monkeypatch.setattr(
        llm_inference, "_ensure_shared_cache_dir_access", lambda _username: None
    )
    monkeypatch.setattr(
        llm_inference,
        "list_user_slurm_accounts",
        lambda _username: ["proj-delta-cpu", "bgns-delta-gpu"],
    )

    def fail_if_auto_selected(*_args, **_kwargs):
        raise AssertionError("auto-select should not run when an account is provided")

    monkeypatch.setattr(
        llm_inference,
        "_select_user_slurm_account",
        fail_if_auto_selected,
    )
    monkeypatch.setattr(llm_inference.subprocess, "run", fake_run)

    client = llm_inference.LLMInferenceClient()
    result = client.launch_model(
        "Qwen/Qwen3-8B",
        cluster_username="alice",
        account="proj-delta-cpu",
        num_gpus=2,
    )

    payload = json.loads(captured["command"][-1])

    assert result["success"] is True
    assert payload["params"]["account"] == "proj-delta-cpu"
    assert captured["kwargs"]["env"]["VEC_INF_ACCOUNT"] == "proj-delta-cpu"
    assert captured["kwargs"]["env"]["SLURM_ACCOUNT"] == "proj-delta-cpu"


def test_launch_model_rejects_unassociated_slurm_account(monkeypatch, tmp_path):
    wrapper_path = tmp_path / "impersonate-wrapper"
    wrapper_path.write_text("#!/bin/sh\nexit 0\n")
    wrapper_path.chmod(0o755)

    monkeypatch.setattr(llm_inference, "LLMInferenceDirectClient", FakeDirectClient)
    monkeypatch.setattr(
        settings, "VEC_INF_EXECUTION_MODE", VecInfExecutionMode.IMPERSONATE
    )
    monkeypatch.setattr(settings, "VEC_INF_IMPERSONATE_SCRIPT", str(wrapper_path))
    monkeypatch.setattr(
        llm_inference,
        "_ensure_impersonated_workspace_dir",
        lambda _: tmp_path / "alice",
    )
    monkeypatch.setattr(
        llm_inference, "_ensure_shared_cache_dir_access", lambda _username: None
    )
    monkeypatch.setattr(
        llm_inference,
        "list_user_slurm_accounts",
        lambda _username: ["bgns-delta-gpu"],
    )

    client = llm_inference.LLMInferenceClient()
    result = client.launch_model(
        "Qwen/Qwen3-8B",
        cluster_username="alice",
        account="someone-elses-account",
    )

    assert result["success"] is False
    assert "not associated with alice" in result["error"]


def test_parse_impersonated_response_handles_pty_noise():
    stdout = (
        "2026-04-28 INFO starting\n"
        '\x1b[0m{"success": false, "error": "sbatch failed"}\r\n'
    )

    result = llm_inference.LLMInferenceClient._parse_impersonated_response(stdout, "")

    assert result == {"success": False, "error": "sbatch failed"}


def test_get_model_cache_dirs_uses_model_weights_parent_dir(monkeypatch, tmp_path):
    config_dir = tmp_path / "vec-inf-config"
    config_dir.mkdir()
    (config_dir / "environment.yaml").write_text(
        "\n".join(
            [
                "default_args:",
                "  bind: /scratch/hf:/root/.cache/huggingface",
                "  model_weights_parent_dir: /projects/modelcache/public",
            ]
        )
        + "\n"
    )
    monkeypatch.setattr(settings, "VEC_INF_CONFIG_DIR", str(config_dir))

    dirs = llm_inference._get_model_cache_dirs()

    assert dirs == [Path("/projects/modelcache/public")]


def test_resolve_workspace_root_prefers_shared_then_work_then_log(monkeypatch):
    monkeypatch.setattr(settings, "VEC_INF_SHARED_WORK_ROOT", "/shared")
    monkeypatch.setattr(settings, "VEC_INF_WORK_DIR", "/work")
    monkeypatch.setattr(settings, "VEC_INF_LOG_DIR", "/logs")
    assert settings.resolve_workspace_root() == "/shared"

    monkeypatch.setattr(settings, "VEC_INF_SHARED_WORK_ROOT", None)
    assert settings.resolve_workspace_root() == "/work"

    monkeypatch.setattr(settings, "VEC_INF_WORK_DIR", None)
    assert settings.resolve_workspace_root() == "/logs"
