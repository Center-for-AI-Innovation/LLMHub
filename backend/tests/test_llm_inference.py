import json
import os
import pwd
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

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
    monkeypatch.setattr(
        llm_inference, "_restrict_acl_to_cluster_user", lambda *_args: None
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
        llm_inference._get_impersonation_python(),
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


@pytest.mark.skipif(
    shutil.which("setfacl") is None or shutil.which("getfacl") is None,
    reason="needs real POSIX ACL tools",
)
def test_impersonated_payload_file_is_readable_by_cluster_user(monkeypatch, tmp_path):
    """Regression: the payload file used to be created 0600 inside the
    ACL'd workspace, which set the ACL mask to --- and masked out the
    impersonated user's inherited entry. Nothing is mocked on the filesystem
    side here: the workspace gets its ACLs from the real
    _ensure_impersonated_workspace_dir, and the payload file's ACL is read
    back with real getfacl while the wrapper would be running."""
    real_run = subprocess.run
    # The named ACL entry must be a user that exists on this host.
    cluster_username = pwd.getpwuid(os.getuid()).pw_name
    wrapper_path = tmp_path / "impersonate-wrapper"
    wrapper_path.write_text("#!/bin/sh\nexit 0\n")
    wrapper_path.chmod(0o755)
    captured = {}

    def fake_run(command, **kwargs):
        if command[0] != str(wrapper_path):
            return real_run(command, **kwargs)
        captured["acl"] = real_run(
            ["getfacl", "--omit-header", "--absolute-names", command[-1]],
            text=True,
            capture_output=True,
            check=True,
        ).stdout
        return SimpleNamespace(
            returncode=0,
            stdout='{"success": true, "job_id": "1", "slurm_job_id": "1"}',
            stderr="",
        )

    monkeypatch.setattr(llm_inference, "LLMInferenceDirectClient", FakeDirectClient)
    monkeypatch.setattr(settings, "VEC_INF_EXECUTION_MODE", "impersonate")
    monkeypatch.setattr(settings, "VEC_INF_IMPERSONATE_SCRIPT", str(wrapper_path))
    monkeypatch.setattr(settings, "VEC_INF_SHARED_WORK_ROOT", str(tmp_path / "work"))
    monkeypatch.setattr(
        llm_inference, "_ensure_shared_cache_dir_access", lambda _: None
    )
    monkeypatch.setattr(
        llm_inference,
        "_select_user_slurm_account",
        lambda *_args, **_kwargs: "bgns-delta-gpu",
    )
    monkeypatch.setattr(llm_inference.subprocess, "run", fake_run)

    result = llm_inference.LLMInferenceClient().launch_model(
        "Qwen/Qwen3-8B", cluster_username=cluster_username
    )

    assert result["success"] is True
    acl = captured["acl"].splitlines()
    assert f"user:{cluster_username}:r--" in acl
    assert "mask::r--" in acl
    # The owning group is a primary group shared by many accounts on Delta.
    assert "group::---" in acl
    assert "other::---" in acl


def test_launch_model_uses_provided_slurm_account(monkeypatch, tmp_path):
    captured = {}
    wrapper_path = tmp_path / "impersonate-wrapper"
    wrapper_path.write_text("#!/bin/sh\nexit 0\n")
    wrapper_path.chmod(0o755)
    workspace_dir = tmp_path / "alice"
    workspace_dir.mkdir()

    def fake_run(command, **kwargs):
        captured["command"] = command
        captured["kwargs"] = kwargs
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
    monkeypatch.setattr(
        llm_inference, "_restrict_acl_to_cluster_user", lambda *_args: None
    )
    monkeypatch.setattr(llm_inference.subprocess, "run", fake_run)

    client = llm_inference.LLMInferenceClient()
    result = client.launch_model(
        "Qwen/Qwen3-8B",
        cluster_username="alice",
        account="proj-delta-cpu",
        num_gpus=2,
    )

    payload = captured["payload"]

    assert result["success"] is True
    assert payload["params"]["account"] == "proj-delta-cpu"
    assert captured["kwargs"]["env"]["VEC_INF_ACCOUNT"] == "proj-delta-cpu"
    assert captured["kwargs"]["env"]["SLURM_ACCOUNT"] == "proj-delta-cpu"


def test_launch_model_rejects_unassociated_slurm_account(monkeypatch, tmp_path):
    wrapper_path = tmp_path / "impersonate-wrapper"
    wrapper_path.write_text("#!/bin/sh\nexit 0\n")
    wrapper_path.chmod(0o755)

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
    (tmp_path / "store").chmod(0o700)

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
    (tmp_path / "store").chmod(0o700)

    workspace_dir = tmp_path / "alice"
    workspace_dir.mkdir()

    monkeypatch.setattr(settings, "MODEL_STORE_ROOT", str(tmp_path / "store"))
    monkeypatch.setattr(
        llm_inference, "_ensure_impersonated_workspace_dir", lambda _: workspace_dir
    )
    restricted = []
    monkeypatch.setattr(
        llm_inference,
        "_restrict_acl_to_cluster_user",
        lambda path, user, directory=False: restricted.append((path, user, directory)),
    )

    weights_parent_dir = llm_inference.ensure_gated_model_weights_for_user(
        "alice", "Qwen/Qwen3-8B"
    )

    assert weights_parent_dir == workspace_dir / "model-weights"
    assert restricted == [(weights_parent_dir, "alice", True)]
    linked_config = weights_parent_dir / "Qwen/Qwen3-8B" / "config.json"
    assert (
        linked_config.stat().st_ino
        == store_model_dir.joinpath("config.json").stat().st_ino
    )


def test_resolve_gated_model_store_dir_raises_when_model_missing(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "MODEL_STORE_ROOT", str(tmp_path / "store"))

    try:
        llm_inference.resolve_gated_model_store_dir("Qwen/Qwen3-8B")
    except RuntimeError as exc:
        assert "not found in the protected model store" in str(exc)
    else:
        raise AssertionError("Expected RuntimeError for a missing store model")


def test_resolve_gated_model_store_dir_rejects_traversal(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "MODEL_STORE_ROOT", str(tmp_path / "store"))

    try:
        llm_inference.resolve_gated_model_store_dir("../../etc")
    except RuntimeError as exc:
        assert "Invalid model name" in str(exc)
    else:
        raise AssertionError("Expected RuntimeError for a traversing model_name")


def test_resolve_gated_model_store_dir_returns_store_root_when_staged(
    monkeypatch, tmp_path
):
    store_root = tmp_path / "store"
    store_model_dir = store_root / "Qwen/Qwen3-8B"
    store_model_dir.mkdir(parents=True)
    (store_model_dir / "config.json").write_text("{}")
    store_root.chmod(0o700)

    monkeypatch.setattr(settings, "MODEL_STORE_ROOT", str(store_root))

    weights_parent_dir = llm_inference.resolve_gated_model_store_dir("Qwen/Qwen3-8B")

    # The protected store root itself, not a per-user copy -- direct/shared
    # execution runs as the service account, which already has its own
    # access, so no hard-linking is needed.
    assert weights_parent_dir == store_root


def test_gated_store_refuses_a_group_readable_root(monkeypatch, tmp_path):
    store_root = tmp_path / "store"
    (store_root / "Gated-7B").mkdir(parents=True)
    store_root.chmod(0o770)
    monkeypatch.setattr(settings, "MODEL_STORE_ROOT", str(store_root))

    with pytest.raises(RuntimeError, match="open to group/other"):
        llm_inference.resolve_gated_model_store_dir("Gated-7B")
    with pytest.raises(RuntimeError, match="open to group/other"):
        llm_inference.ensure_gated_model_weights_for_user("alice", "Gated-7B")
    message = llm_inference.start_gated_model_download(
        "Other-7B", "org/other", "user-token"
    )
    assert "open to group/other" in message


def test_gated_store_root_is_created_owner_only(monkeypatch, tmp_path):
    store_root = tmp_path / "missing" / "store"
    monkeypatch.setattr(settings, "MODEL_STORE_ROOT", str(store_root))
    monkeypatch.setattr(llm_inference.threading, "Thread", _NoopThread)
    monkeypatch.setattr(llm_inference, "_gated_downloads_in_progress", set())

    llm_inference.start_gated_model_download("Gated-7B", "org/gated", "user-token")

    assert store_root.stat().st_mode & 0o777 == 0o700


class _NoopThread:
    def __init__(self, *args, **kwargs):
        pass

    def start(self):
        pass


def test_shared_cache_dirs_come_from_settings_only(monkeypatch):
    monkeypatch.setattr(settings, "MODEL_CACHE_DIR", "/cache/huggingface")
    monkeypatch.setattr(settings, "COMPILE_CACHE_DIR", None)

    assert llm_inference._get_shared_cache_dirs() == [Path("/cache/huggingface")]


def test_gated_model_downloads_into_store_then_is_found(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "MODEL_STORE_ROOT", str(tmp_path))

    def fake_snapshot_download(repo_id, local_dir, token, ignore_patterns):
        assert (repo_id, token) == ("org/gated", "user-token")
        Path(local_dir).mkdir(parents=True, exist_ok=True)
        (Path(local_dir) / "config.json").write_text("{}")

    class InlineThread:
        def __init__(self, target, args, daemon):
            self._run = lambda: target(*args)

        def start(self):
            self._run()

    monkeypatch.setattr(llm_inference, "snapshot_download", fake_snapshot_download)
    monkeypatch.setattr(llm_inference.threading, "Thread", InlineThread)

    message = llm_inference.start_gated_model_download(
        "Gated-7B", "org/gated", "user-token"
    )

    assert "Downloading" in message
    config = tmp_path / "Gated-7B" / "config.json"
    assert config.stat().st_mode & 0o777 == 0o644
    assert not (tmp_path / "Gated-7B.partial").exists()
    assert (
        llm_inference.start_gated_model_download("Gated-7B", "org/gated", "user-token")
        is None
    )


@pytest.mark.skipif(
    shutil.which("setfacl") is None or shutil.which("getfacl") is None,
    reason="needs real POSIX ACL tools",
)
def test_model_weights_dir_is_closed_to_the_owning_group(tmp_path):
    cluster_username = pwd.getpwuid(os.getuid()).pw_name
    weights_dir = tmp_path / "model-weights"
    weights_dir.mkdir(mode=0o770)

    llm_inference._restrict_acl_to_cluster_user(
        weights_dir, cluster_username, directory=True
    )

    acl = subprocess.run(
        ["getfacl", "--omit-header", "--absolute-names", str(weights_dir)],
        text=True,
        capture_output=True,
        check=True,
    ).stdout.splitlines()
    assert f"user:{cluster_username}:r-x" in acl
    assert "group::---" in acl
    assert "other::---" in acl
