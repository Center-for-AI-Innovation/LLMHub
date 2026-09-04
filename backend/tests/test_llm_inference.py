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


def test_select_user_slurm_account_prefers_gpu(monkeypatch, tmp_path):
    accounts_script = tmp_path / "accounts"
    accounts_script.write_text("#!/bin/sh\n")

    def fake_run(command, **kwargs):
        assert command == [str(accounts_script), "-u", "alice"]
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
    monkeypatch.setattr(settings, "VEC_INF_ACCOUNTS_SCRIPT", str(accounts_script))

    assert llm_inference._select_user_slurm_account("alice") == "proj-delta-gpu"


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
    monkeypatch.setattr(settings, "VEC_INF_EXECUTION_MODE", "impersonate")
    monkeypatch.setattr(settings, "VEC_INF_IMPERSONATE_SCRIPT", str(wrapper_path))
    monkeypatch.setattr(
        llm_inference,
        "_ensure_impersonated_workspace_dir",
        lambda _: tmp_path / "alice",
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
    assert captured["command"][:4] == [
        str(wrapper_path),
        "alice",
        "--",
        llm_inference.sys.executable,
    ]
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


def test_hardlink_tree_links_files_and_preserves_structure(tmp_path):
    src = tmp_path / "src"
    (src / "nested").mkdir(parents=True)
    (src / "config.json").write_text("{}")
    (src / "nested" / "weights.bin").write_text("weights")

    dst = tmp_path / "dst"
    llm_inference._hardlink_tree(src, dst)

    assert dst.joinpath("config.json").read_text() == "{}"
    assert dst.joinpath("nested", "weights.bin").read_text() == "weights"
    # Hard links share the same inode as the source file.
    assert (
        dst.joinpath("config.json").stat().st_ino
        == src.joinpath("config.json").stat().st_ino
    )


def test_hardlink_tree_leaves_existing_destination_files_untouched(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    (src / "config.json").write_text("new")

    dst = tmp_path / "dst"
    dst.mkdir()
    (dst / "config.json").write_text("already-there")

    llm_inference._hardlink_tree(src, dst)

    assert dst.joinpath("config.json").read_text() == "already-there"


def test_resolve_model_store_dir_none_when_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "MODEL_STORE_ROOT", None)

    assert llm_inference._resolve_model_store_dir("Qwen/Qwen3-8B") is None


def test_resolve_model_store_dir_joins_model_name(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "MODEL_STORE_ROOT", str(tmp_path))

    assert llm_inference._resolve_model_store_dir("Qwen/Qwen3-8B") == (
        tmp_path / "Qwen/Qwen3-8B"
    )


def test_ensure_gated_model_weights_for_user_raises_when_model_missing(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(settings, "MODEL_STORE_ROOT", str(tmp_path / "store"))

    try:
        llm_inference.ensure_gated_model_weights_for_user("alice", "Qwen/Qwen3-8B")
    except RuntimeError as exc:
        assert "not found in the shared model store" in str(exc)
    else:
        raise AssertionError("Expected RuntimeError for a missing store model")


def test_ensure_gated_model_weights_for_user_raises_without_workspace_root(
    monkeypatch, tmp_path
):
    store_model_dir = tmp_path / "store" / "Qwen/Qwen3-8B"
    store_model_dir.mkdir(parents=True)
    (store_model_dir / "config.json").write_text("{}")

    monkeypatch.setattr(settings, "MODEL_STORE_ROOT", str(tmp_path / "store"))
    monkeypatch.setattr(
        llm_inference, "_ensure_impersonated_workspace_dir", lambda _: None
    )

    try:
        llm_inference.ensure_gated_model_weights_for_user("alice", "Qwen/Qwen3-8B")
    except RuntimeError as exc:
        assert "no impersonated workspace root configured" in str(exc)
    else:
        raise AssertionError("Expected RuntimeError when no workspace root is set")


def test_ensure_gated_model_weights_for_user_links_into_workspace(
    monkeypatch, tmp_path
):
    store_model_dir = tmp_path / "store" / "Qwen/Qwen3-8B"
    store_model_dir.mkdir(parents=True)
    (store_model_dir / "config.json").write_text("{}")

    workspace_dir = tmp_path / "alice"
    workspace_dir.mkdir()

    monkeypatch.setattr(settings, "MODEL_STORE_ROOT", str(tmp_path / "store"))
    monkeypatch.setattr(
        llm_inference, "_ensure_impersonated_workspace_dir", lambda _: workspace_dir
    )

    weights_parent_dir = llm_inference.ensure_gated_model_weights_for_user(
        "alice", "Qwen/Qwen3-8B"
    )

    assert weights_parent_dir == workspace_dir / "model-weights"
    linked_config = weights_parent_dir / "Qwen/Qwen3-8B" / "config.json"
    assert (
        linked_config.stat().st_ino
        == store_model_dir.joinpath("config.json").stat().st_ino
    )
