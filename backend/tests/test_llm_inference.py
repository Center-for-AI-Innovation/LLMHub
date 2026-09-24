import json
from pathlib import Path
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


def test_launch_model_impersonated_requires_workspace_dir(monkeypatch, tmp_path):
    """No shared workspace root means no safe place to hand off the launch
    payload (which can carry a secret), so refuse rather than silently
    launching without one."""
    wrapper_path = tmp_path / "impersonate-wrapper"
    wrapper_path.write_text("#!/bin/sh\nexit 0\n")
    wrapper_path.chmod(0o755)

    monkeypatch.setattr(llm_inference, "LLMInferenceDirectClient", FakeDirectClient)
    monkeypatch.setattr(settings, "VEC_INF_EXECUTION_MODE", "impersonate")
    monkeypatch.setattr(settings, "VEC_INF_IMPERSONATE_SCRIPT", str(wrapper_path))
    monkeypatch.setattr(
        llm_inference, "_ensure_impersonated_workspace_dir", lambda _: None
    )
    monkeypatch.setattr(
        llm_inference,
        "_select_user_slurm_account",
        lambda *_args, **_kwargs: "bgns-delta-gpu",
    )

    client = llm_inference.LLMInferenceClient()
    result = client.launch_model("Qwen/Qwen3-8B", cluster_username="alice")

    assert result["success"] is False
    assert "no workspace directory configured" in result["error"]


def test_launch_model_runs_impersonated_subprocess(monkeypatch, tmp_path):
    captured = {}
    wrapper_path = tmp_path / "impersonate-wrapper"
    wrapper_path.write_text("#!/bin/sh\nexit 0\n")
    wrapper_path.chmod(0o755)
    workspace_dir = tmp_path / "alice"
    workspace_dir.mkdir()

    def fake_run(command, **kwargs):
        captured["command"] = command
        captured["kwargs"] = kwargs
        # The payload file must exist (and be readable) at this point -- the
        # real code deletes it only after subprocess.run returns.
        captured["payload_path"] = command[-1]
        captured["payload"] = json.loads(Path(command[-1]).read_text())
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
        lambda _: workspace_dir,
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

    payload = captured["payload"]

    assert result["success"] is True
    assert captured["command"][:4] == [
        str(wrapper_path),
        "alice",
        "--",
        llm_inference.sys.executable,
    ]
    assert captured["command"][4:6] == ["-m", "app.utils.vec_inf_launch_shim"]
    # The secret-bearing payload travels as a file path, never inline in argv
    # (argv is visible to any user on the host via ps/`/proc/<pid>/cmdline`).
    assert captured["command"][-1] != json.dumps(payload)
    assert captured["command"][-1].startswith(str(workspace_dir))
    assert captured["kwargs"]["cwd"] == str(llm_inference.PROJECT_ROOT)
    assert captured["kwargs"]["env"]["VEC_INF_ACCOUNT"] == "bgns-delta-gpu"
    assert captured["kwargs"]["env"]["SLURM_ACCOUNT"] == "bgns-delta-gpu"
    assert captured["kwargs"]["env"]["VEC_INF_LOG_DIR"].endswith("/alice")
    assert payload["params"]["work_dir"].endswith("/alice")
    assert payload["params"]["log_dir"].endswith("/alice")
    # The payload file is cleaned up once the subprocess call returns.
    assert not Path(captured["payload_path"]).exists()


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


def test_resolve_model_store_dir_rejects_parent_traversal(monkeypatch, tmp_path):
    store_root = tmp_path / "store"
    store_root.mkdir()
    monkeypatch.setattr(settings, "MODEL_STORE_ROOT", str(store_root))

    try:
        llm_inference._resolve_model_store_dir("../../etc")
    except ValueError as exc:
        assert "resolves outside" in str(exc)
    else:
        raise AssertionError("Expected ValueError for a traversing model_name")


def test_resolve_model_store_dir_rejects_absolute_override(monkeypatch, tmp_path):
    store_root = tmp_path / "store"
    store_root.mkdir()
    monkeypatch.setattr(settings, "MODEL_STORE_ROOT", str(store_root))

    # pathlib's `/` operator treats an absolute right-hand side as replacing
    # the left side entirely, so a naive join would silently escape the store.
    try:
        llm_inference._resolve_model_store_dir("/etc")
    except ValueError as exc:
        assert "resolves outside" in str(exc)
    else:
        raise AssertionError("Expected ValueError for an absolute model_name")


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


def test_ensure_gated_model_weights_for_user_rejects_traversal(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "MODEL_STORE_ROOT", str(tmp_path / "store"))
    monkeypatch.setattr(
        llm_inference,
        "_ensure_impersonated_workspace_dir",
        lambda _: tmp_path / "alice",
    )

    try:
        llm_inference.ensure_gated_model_weights_for_user("alice", "../../etc")
    except RuntimeError as exc:
        assert "Invalid model name" in str(exc)
    else:
        raise AssertionError("Expected RuntimeError for a traversing model_name")


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


def test_resolve_gated_model_store_dir_raises_when_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "MODEL_STORE_ROOT", None)

    try:
        llm_inference.resolve_gated_model_store_dir()
    except RuntimeError as exc:
        assert "MODEL_STORE_ROOT is not configured" in str(exc)
    else:
        raise AssertionError("Expected RuntimeError when MODEL_STORE_ROOT is unset")


def test_resolve_gated_model_store_dir_returns_store_root(monkeypatch, tmp_path):
    store_root = tmp_path / "store"
    monkeypatch.setattr(settings, "MODEL_STORE_ROOT", str(store_root))

    # No existence check here by design: vec-inf's own cached-weights check
    # already prefers a pre-staged local copy and falls back to a live
    # hf_model download otherwise -- this just needs to point at the
    # protected location either way.
    weights_parent_dir = llm_inference.resolve_gated_model_store_dir()

    assert weights_parent_dir == store_root


def test_resolve_gated_bind_override_raises_when_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "MODEL_STORE_ROOT", None)

    try:
        llm_inference.resolve_gated_bind_override()
    except RuntimeError as exc:
        assert "MODEL_STORE_ROOT is not configured" in str(exc)
    else:
        raise AssertionError("Expected RuntimeError when MODEL_STORE_ROOT is unset")


def test_resolve_gated_bind_override_raises_without_matching_default_entry(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(settings, "MODEL_STORE_ROOT", str(tmp_path / "store"))
    monkeypatch.setattr(
        llm_inference, "DEFAULT_ARGS", {"bind": "/some/other/path:/root/.cache/other"}
    )

    try:
        llm_inference.resolve_gated_bind_override()
    except RuntimeError as exc:
        assert "No bind entry targeting" in str(exc)
    else:
        raise AssertionError("Expected RuntimeError when no bind entry matches")


def test_resolve_gated_bind_override_replaces_only_the_hf_cache_entry(
    monkeypatch, tmp_path
):
    store_root = tmp_path / "store"
    monkeypatch.setattr(settings, "MODEL_STORE_ROOT", str(store_root))
    monkeypatch.setattr(
        llm_inference,
        "DEFAULT_ARGS",
        {
            "bind": (
                "/projects/modelcache/public/huggingface:/root/.cache/huggingface,"
                "/projects/modelcache/public/torch_inductor:/root/.cache/torch_inductor"
            )
        },
    )

    bind = llm_inference.resolve_gated_bind_override()

    entries = bind.split(",")
    assert f"{store_root / 'huggingface'}:/root/.cache/huggingface" in entries
    # The unrelated torch_inductor entry is preserved unchanged.
    assert (
        "/projects/modelcache/public/torch_inductor:/root/.cache/torch_inductor"
        in entries
    )
    assert len(entries) == 2
