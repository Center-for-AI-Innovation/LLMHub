import json
import os
import pwd
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
from vec_inf.client._helper import ModelLauncher
from vec_inf.client._slurm_script_generator import SlurmScriptGenerator
from vec_inf.client._slurm_templates import SLURM_SCRIPT_TEMPLATE
from vec_inf.client._slurm_vars import CONTAINER_MODULE_NAME, IMAGE_PATH

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
    monkeypatch.setattr(
        settings, "VEC_INF_EXECUTION_MODE", VecInfExecutionMode.IMPERSONATE
    )
    monkeypatch.setattr(settings, "VEC_INF_IMPERSONATE_SCRIPT", str(wrapper_path))
    monkeypatch.setattr(
        llm_inference,
        "_ensure_impersonated_workspace_dir",
        lambda _: workspace_dir,
    )
    monkeypatch.setattr(
        llm_inference, "_ensure_shared_cache_dir_access", lambda _username: None
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
        deployment_api_key="deployment-key-abc",
        num_gpus=2,
    )

    payload = captured["payload"]

    assert result["success"] is True
    assert captured["command"][:5] == [
        str(wrapper_path),
        "--no-login-shell",
        "alice",
        "--",
        llm_inference._get_impersonation_python(),
    ]
    assert captured["command"][5:7] == ["-m", "app.utils.vec_inf_launch_shim"]
    # The payload travels as a file path, never inline in argv
    # (argv is visible to any user on the host via ps/`/proc/<pid>/cmdline`).
    assert captured["command"][-1] != json.dumps(payload)
    assert captured["command"][-1].startswith(str(workspace_dir))
    assert captured["kwargs"]["cwd"] == str(workspace_dir)
    assert captured["kwargs"]["env"]["VEC_INF_ACCOUNT"] == "bgns-delta-gpu"
    assert captured["kwargs"]["env"]["SLURM_ACCOUNT"] == "bgns-delta-gpu"
    assert captured["kwargs"]["env"]["VEC_INF_LOG_DIR"].endswith("/alice")
    assert payload["params"]["work_dir"].endswith("/alice")
    assert payload["params"]["log_dir"].endswith("/alice")
    # sudo drops the environment, so the deployment key rides in the payload
    # file, never in argv or in params (which end up on the deployment row).
    assert payload["deployment_api_key"] == "deployment-key-abc"
    assert "deployment_api_key" not in payload["params"]
    assert not any("deployment-key-abc" in part for part in captured["command"])
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
    monkeypatch.setattr(
        settings, "VEC_INF_EXECUTION_MODE", VecInfExecutionMode.IMPERSONATE
    )
    monkeypatch.setattr(settings, "VEC_INF_IMPERSONATE_SCRIPT", str(wrapper_path))
    monkeypatch.setattr(
        llm_inference,
        "_ensure_impersonated_workspace_dir",
        lambda _: workspace_dir,
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

    with pytest.raises(RuntimeError, match="open to other accounts"):
        llm_inference.resolve_gated_model_store_dir("Gated-7B")
    with pytest.raises(RuntimeError, match="open to other accounts"):
        llm_inference.ensure_gated_model_weights_for_user("alice", "Gated-7B")
    with pytest.raises(RuntimeError, match="open to other accounts"):
        llm_inference.start_gated_model_download("Other-7B", "org/other", "user-token")


def test_gated_store_root_is_created_owner_only(monkeypatch, tmp_path):
    store_root = tmp_path / "missing" / "store"
    monkeypatch.setattr(settings, "MODEL_STORE_ROOT", str(store_root))
    monkeypatch.setattr(llm_inference.threading, "Thread", _NoopThread)
    monkeypatch.setattr(llm_inference, "_downloads_in_progress", set())

    llm_inference.start_gated_model_download("Gated-7B", "org/gated", "user-token")

    assert store_root.stat().st_mode & 0o777 == 0o700


@pytest.mark.skipif(
    shutil.which("setfacl") is None or shutil.which("getfacl") is None,
    reason="needs POSIX ACL tools",
)
def test_gated_store_accepts_delta_style_acl(monkeypatch, tmp_path):
    # Delta's store: mode 770 (group bits are the ACL mask), group::---, and a
    # named entry for the service account only.
    store_root = tmp_path / "restricted"
    store_root.mkdir()
    store_root.chmod(0o770)
    subprocess.run(
        ["setfacl", "-m", f"u:{os.geteuid()}:rwx,g::---,o::---", str(store_root)],
        check=True,
    )
    monkeypatch.setattr(settings, "MODEL_STORE_ROOT", str(store_root))

    llm_inference._check_store_root_private()

    subprocess.run(["setfacl", "-m", "u:65534:r-x", str(store_root)], check=True)
    with pytest.raises(RuntimeError, match="user:65534:r-x"):
        llm_inference._check_store_root_private()


class _NoopThread:
    def __init__(self, *args, **kwargs):
        pass

    def start(self):
        pass


def test_shared_cache_dirs_never_include_the_model_cache(monkeypatch):
    monkeypatch.setattr(settings, "MODEL_CACHE_DIR", "/cache/huggingface")
    monkeypatch.setattr(settings, "COMPILE_CACHE_DIR", "/cache/torch_inductor")

    assert llm_inference._get_shared_cache_dirs() == [Path("/cache/torch_inductor")]


def test_public_model_downloads_into_cache_then_is_found(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "MODEL_CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(llm_inference, "_downloads_in_progress", set())

    def fake_snapshot_download(repo_id, cache_dir, token, ignore_patterns):
        assert (repo_id, cache_dir, token) == ("org/public", tmp_path, False)
        snapshot = Path(cache_dir) / "models--org--public" / "snapshots" / "abc"
        snapshot.mkdir(parents=True)
        (snapshot / "config.json").write_text("{}")

    class InlineThread:
        def __init__(self, target, args, daemon):
            self._run = lambda: target(*args)

        def start(self):
            self._run()

    monkeypatch.setattr(llm_inference, "snapshot_download", fake_snapshot_download)
    monkeypatch.setattr(llm_inference.threading, "Thread", InlineThread)

    assert llm_inference.start_public_model_download("org/public") is True
    assert llm_inference.start_public_model_download("org/public") is False
    assert llm_inference.public_model_download_state("org/public") == ("ready", None)


def test_public_download_leaves_nothing_group_or_other_writable(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "MODEL_CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(llm_inference, "_downloads_in_progress", set())

    def fake_snapshot_download(repo_id, cache_dir, token, ignore_patterns):
        # What huggingface_hub 2.x leaves in its shared blob store.
        prefix = Path(cache_dir) / "blobs" / "ab"
        prefix.mkdir(parents=True)
        for name in ("abcd.refs", "abcd.lock"):
            (prefix / name).touch()
            (prefix / name).chmod(0o666)
        (prefix / "abcd").touch()
        (prefix / "abcd").chmod(0o444)
        (Path(cache_dir) / "models--org--public").mkdir()

    class InlineThread:
        def __init__(self, target, args, daemon):
            self._run = lambda: target(*args)

        def start(self):
            self._run()

    monkeypatch.setattr(llm_inference, "snapshot_download", fake_snapshot_download)
    monkeypatch.setattr(llm_inference.threading, "Thread", InlineThread)

    llm_inference.start_public_model_download("org/public")

    prefix = tmp_path / "blobs" / "ab"
    assert (prefix / "abcd.refs").stat().st_mode & 0o777 == 0o644
    assert (prefix / "abcd.lock").stat().st_mode & 0o777 == 0o644
    assert (prefix / "abcd").stat().st_mode & 0o777 == 0o444
    assert (tmp_path / "models--org--public" / ".llmhub-complete").is_file()


def test_failed_public_download_is_reported_then_retried(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "MODEL_CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(llm_inference, "_downloads_in_progress", set())
    monkeypatch.setattr(llm_inference, "_download_failures", {})
    (tmp_path / "models--org--public" / "snapshots" / "abc").mkdir(parents=True)

    def failing_snapshot_download(**kwargs):
        raise OSError("connection reset")

    class InlineThread:
        def __init__(self, target, args, daemon):
            self._run = lambda: target(*args)

        def start(self):
            self._run()

    monkeypatch.setattr(llm_inference, "snapshot_download", failing_snapshot_download)
    monkeypatch.setattr(llm_inference.threading, "Thread", InlineThread)

    # A partial snapshot without the marker is not a cached model.
    assert llm_inference.start_public_model_download("org/public") is True
    assert llm_inference.public_model_download_state("org/public") == (
        "failed",
        "connection reset",
    )

    # Launching again starts a fresh download, which clears the old failure.
    monkeypatch.setattr(llm_inference.threading, "Thread", _NoopThread)
    assert llm_inference.start_public_model_download("org/public") is True
    assert llm_inference.public_model_download_state("org/public") == (
        "downloading",
        None,
    )


def test_public_download_cut_short_by_a_restart_reads_as_missing(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "MODEL_CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(llm_inference, "_downloads_in_progress", set())
    monkeypatch.setattr(llm_inference, "_download_failures", {})

    assert llm_inference.public_model_download_state("org/public") == (
        "missing",
        None,
    )


def test_public_download_is_skipped_without_a_model_cache(monkeypatch):
    monkeypatch.setattr(settings, "MODEL_CACHE_DIR", None)

    assert llm_inference.start_public_model_download("org/public") is False
    assert llm_inference.public_model_download_state("org/public") == ("ready", None)


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

    assert (
        llm_inference.start_gated_model_download("Gated-7B", "org/gated", "user-token")
        is True
    )

    config = tmp_path / "Gated-7B" / "config.json"
    assert config.stat().st_mode & 0o777 == 0o644
    assert not (tmp_path / "Gated-7B.partial").exists()
    assert (
        llm_inference.start_gated_model_download("Gated-7B", "org/gated", "user-token")
        is False
    )
    assert llm_inference.gated_model_download_state("Gated-7B") == ("ready", None)


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


def test_launch_options_derive_parallel_sizes_from_gpu_request():
    client = object.__new__(llm_inference.LLMInferenceDirectClient)
    client.slurm_account = None

    options = client._build_launch_options(num_gpus=4, num_nodes=2)

    assert options.gpus_per_node == 4
    assert options.vllm_args == ("--tensor-parallel-size=4,--pipeline-parallel-size=2")
    assert client._build_launch_options().vllm_args is None


def test_gated_store_functions_say_when_the_store_is_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "MODEL_STORE_ROOT", None)

    with pytest.raises(RuntimeError, match="MODEL_STORE_ROOT is not set"):
        llm_inference.ensure_gated_model_weights_for_user("alice", "Gated-7B")
    with pytest.raises(RuntimeError, match="MODEL_STORE_ROOT is not set"):
        llm_inference.resolve_gated_model_store_dir("Gated-7B")


def _private_store(tmp_path, monkeypatch):
    store_root = tmp_path / "store"
    (store_root / "Gated-7B").mkdir(parents=True)
    (store_root / "Gated-7B" / "config.json").write_text("{}")
    store_root.chmod(0o700)
    monkeypatch.setattr(settings, "MODEL_STORE_ROOT", str(store_root))
    return store_root


def _fake_getfacl(monkeypatch, *, raises=None, stdout=""):
    real_run = subprocess.run

    def _run(command, *args, **kwargs):
        if command and command[0] == "getfacl":
            if raises is not None:
                raise raises
            return SimpleNamespace(stdout=stdout, stderr="", returncode=0)
        return real_run(command, *args, **kwargs)

    monkeypatch.setattr(llm_inference.subprocess, "run", _run)


@pytest.mark.parametrize(
    "fake",
    [
        {"raises": subprocess.CalledProcessError(1, ["getfacl"], stderr="denied")},
        {"stdout": "this is not an ACL line\n"},
    ],
    ids=["getfacl-fails", "unparseable-acl"],
)
def test_store_check_failures_become_runtime_errors(monkeypatch, tmp_path, fake):
    """Callers only catch RuntimeError; anything else would be an HTTP 500."""
    _private_store(tmp_path, monkeypatch)
    _fake_getfacl(monkeypatch, **fake)

    with pytest.raises(RuntimeError, match="Cannot check MODEL_STORE_ROOT"):
        llm_inference.resolve_gated_model_store_dir("Gated-7B")
    with pytest.raises(RuntimeError, match="Cannot check MODEL_STORE_ROOT"):
        llm_inference.ensure_gated_model_weights_for_user("alice", "Gated-7B")
    with pytest.raises(RuntimeError, match="Cannot check MODEL_STORE_ROOT"):
        llm_inference.start_gated_model_download("Other-7B", "org/other", "user-token")


def test_cross_filesystem_hard_link_becomes_a_runtime_error(monkeypatch, tmp_path):
    """os.link raises EXDEV when the store and workspace are on different
    filesystems, an easy misconfiguration."""
    import errno

    _private_store(tmp_path, monkeypatch)
    workspace_dir = tmp_path / "alice"
    workspace_dir.mkdir()
    monkeypatch.setattr(
        llm_inference, "_ensure_impersonated_workspace_dir", lambda _: workspace_dir
    )
    monkeypatch.setattr(
        llm_inference, "_restrict_acl_to_cluster_user", lambda *a, **k: None
    )

    def _exdev(src, dst):
        raise OSError(errno.EXDEV, "Invalid cross-device link")

    monkeypatch.setattr(llm_inference.os, "link", _exdev)

    with pytest.raises(RuntimeError, match="Failed to link 'Gated-7B'.*cross-device"):
        llm_inference.ensure_gated_model_weights_for_user("alice", "Gated-7B")


def test_workspace_mkdir_failure_becomes_a_runtime_error(monkeypatch, tmp_path):
    _private_store(tmp_path, monkeypatch)

    def _no_permission(_):
        raise PermissionError(13, "Permission denied", "/projects/llmhub/dev/alice")

    monkeypatch.setattr(
        llm_inference, "_ensure_impersonated_workspace_dir", _no_permission
    )

    with pytest.raises(RuntimeError, match="Failed to link.*Permission denied"):
        llm_inference.ensure_gated_model_weights_for_user("alice", "Gated-7B")


def test_resolve_workspace_root_prefers_shared_then_work_then_log(monkeypatch):
    monkeypatch.setattr(settings, "VEC_INF_SHARED_WORK_ROOT", "/shared")
    monkeypatch.setattr(settings, "VEC_INF_WORK_DIR", "/work")
    monkeypatch.setattr(settings, "VEC_INF_LOG_DIR", "/logs")
    assert settings.resolve_workspace_root() == "/shared"

    monkeypatch.setattr(settings, "VEC_INF_SHARED_WORK_ROOT", None)
    assert settings.resolve_workspace_root() == "/work"

    monkeypatch.setattr(settings, "VEC_INF_WORK_DIR", None)
    assert settings.resolve_workspace_root() == "/logs"


def test_ensure_cuda_visible_devices_env_appends_canonical_field():
    env = llm_inference.LLMInferenceDirectClient._ensure_cuda_visible_devices_env(
        "HF_HOME=/root/.cache/huggingface"
    )

    assert env == (
        "HF_HOME=/root/.cache/huggingface," "CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES"
    )


def test_ensure_cuda_visible_devices_env_without_existing_value():
    for env_value in (None, ""):
        env = llm_inference.LLMInferenceDirectClient._ensure_cuda_visible_devices_env(
            env_value
        )

        assert env == "CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES"


def test_ensure_cuda_visible_devices_env_drops_duplicate_field():
    env = llm_inference.LLMInferenceDirectClient._ensure_cuda_visible_devices_env(
        "HF_HOME=/root/.cache/huggingface,CUDA_VISIBLE_DEVICES=0,1"
    )

    assert env.count("CUDA_VISIBLE_DEVICES=") == 1
    assert env.endswith("CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES")


def test_ensure_cuda_visible_devices_env_preserves_similarly_named_field():
    env = llm_inference.LLMInferenceDirectClient._ensure_cuda_visible_devices_env(
        "MY_CUDA_VISIBLE_DEVICES=0"
    )

    assert env == (
        "MY_CUDA_VISIBLE_DEVICES=0," "CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES"
    )


@pytest.mark.parametrize(
    "env_value",
    [
        "HF_HOME=/x,CUDA_VISIBLE_DEVICES=0,1",
        "HF_HOME=/x,CUDA_VISIBLE_DEVICES=0,1,2",
    ],
)
def test_literal_cuda_visible_devices_list_is_replaced(env_value):
    env = llm_inference.LLMInferenceDirectClient._ensure_cuda_visible_devices_env(
        env_value
    )

    assert env == "HF_HOME=/x,CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES"
    assert ModelLauncher.__new__(ModelLauncher)._process_env_vars(env) == {
        "HF_HOME": "/x",
        "CUDA_VISIBLE_DEVICES": "$CUDA_VISIBLE_DEVICES",
    }


@pytest.mark.parametrize(
    ("env_value", "stray_field"),
    [
        ("HF_HOME=/x,1,CUDA_VISIBLE_DEVICES=0,1,2", "1"),
        ("HF_HOME=/x,3,CUDA_VISIBLE_DEVICES=0,1", "3"),
        ("HF_HOME=/x,CUDA_VISIBLE_DEVICES=0,1,PYTHON_PATH=/x,/y", "/y"),
    ],
)
def test_stray_bare_field_outside_cuda_value_fails_loudly(
    monkeypatch, tmp_path, env_value, stray_field
):
    """Bare fields outside CUDA_VISIBLE_DEVICES are typos, not GPU indices.

    vec-inf reads a field without ``=`` as an env-file path, so the launch
    fails instead of silently dropping the value.
    """
    monkeypatch.chdir(tmp_path)
    env = llm_inference.LLMInferenceDirectClient._ensure_cuda_visible_devices_env(
        env_value
    )

    assert stray_field in env.split(",")
    with pytest.raises(FileNotFoundError, match=f"'{stray_field}'"):
        ModelLauncher.__new__(ModelLauncher)._process_env_vars(env)


def test_ensure_cuda_visible_devices_env_strips_stale_quoted_workaround():
    stale = (
        "HF_HOME=/root/.cache/huggingface,"
        '\\"CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES\\"'
    )

    env = llm_inference.LLMInferenceDirectClient._ensure_cuda_visible_devices_env(stale)

    assert "\\" not in env
    assert env.count("CUDA_VISIBLE_DEVICES=") == 1
    assert env.endswith("CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES")


@pytest.mark.parametrize(
    "env_value",
    [
        "HF_HOME=/x,CUDA_VISIBLE_DEVICES=0,1,2,3",
        "HF_HOME=/x,CUDA_VISIBLE_DEVICES=-1",
        "HF_HOME=/x,CUDA_VISIBLE_DEVICES=GPU-a1b2,GPU-c3d4",
        "HF_HOME=/x,CUDA_VISIBLE_DEVICES=MIG-39d1a7f3-9b1e,MIG-84e5ac57-3a91",
        "HF_HOME=/x,CUDA_VISIBLE_DEVICES=MIG-GPU-abc123/1/0,MIG-GPU-def456/2/1",
        "HF_HOME=/x,CUDA_VISIBLE_DEVICES=0,GPU-a1b2,MIG-GPU-def456/2/1",
    ],
)
def test_cuda_visible_devices_device_tokens_are_consumed(env_value):
    """Issue #56: UUID and MIG tails must not leak as bare vec-inf fields."""
    env = llm_inference.LLMInferenceDirectClient._ensure_cuda_visible_devices_env(
        env_value
    )

    assert env == "HF_HOME=/x,CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES"
    assert ModelLauncher.__new__(ModelLauncher)._process_env_vars(env) == {
        "HF_HOME": "/x",
        "CUDA_VISIBLE_DEVICES": "$CUDA_VISIBLE_DEVICES",
    }


@pytest.mark.parametrize(
    "env_value",
    [
        'HF_HOME=/x,CUDA_VISIBLE_DEVICES="0,1,2,3"',
        "HF_HOME=/x,CUDA_VISIBLE_DEVICES='0,1'",
        'HF_HOME=/x,CUDA_VISIBLE_DEVICES="GPU-a1b2,GPU-c3d4"',
        "HF_HOME=/x,CUDA_VISIBLE_DEVICES='MIG-39d1a7f3-9b1e,MIG-84e5ac57-3a91'",
        'HF_HOME=/x,\\"CUDA_VISIBLE_DEVICES=0,1,2\\"',
    ],
)
def test_cuda_visible_devices_quoted_lists_are_consumed(env_value):
    """Quoted pre-seeds leave quote-bearing tails that must be consumed."""
    env = llm_inference.LLMInferenceDirectClient._ensure_cuda_visible_devices_env(
        env_value
    )

    assert env == "HF_HOME=/x,CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES"
    assert ModelLauncher.__new__(ModelLauncher)._process_env_vars(env) == {
        "HF_HOME": "/x",
        "CUDA_VISIBLE_DEVICES": "$CUDA_VISIBLE_DEVICES",
    }


@pytest.mark.parametrize(
    "env_value",
    [
        "HF_HOME=/x,CUDA_VISIBLE_DEVICES",
        "HF_HOME=/x,CUDA_VISIBLE_DEVICES,0,1",
        "HF_HOME=/x,'CUDA_VISIBLE_DEVICES'",
    ],
)
def test_cuda_visible_devices_bare_name_is_consumed(env_value):
    """A bare field is an env-file path for vec-inf, so it must be dropped."""
    env = llm_inference.LLMInferenceDirectClient._ensure_cuda_visible_devices_env(
        env_value
    )

    assert env == "HF_HOME=/x,CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES"
    assert ModelLauncher.__new__(ModelLauncher)._process_env_vars(env) == {
        "HF_HOME": "/x",
        "CUDA_VISIBLE_DEVICES": "$CUDA_VISIBLE_DEVICES",
    }


def test_cuda_continuation_fields_are_dropped_until_next_key():
    env = llm_inference.LLMInferenceDirectClient._ensure_cuda_visible_devices_env(
        "HF_HOME=/x,CUDA_VISIBLE_DEVICES=0,x,1,FOO=bar"
    )

    assert env == "HF_HOME=/x,FOO=bar,CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES"


@pytest.mark.parametrize(
    "env_value",
    ["HF_HOME=/x,", "HF_HOME=/x,,", "HF_HOME=/x, ,CUDA_VISIBLE_DEVICES=0,1, "],
)
def test_ensure_cuda_visible_devices_env_drops_blank_fields(env_value):
    env = llm_inference.LLMInferenceDirectClient._ensure_cuda_visible_devices_env(
        env_value
    )

    assert env == "HF_HOME=/x,CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES"


def test_request_env_extends_deployment_env(monkeypatch):
    monkeypatch.setattr(settings, "VEC_INF_ENV", "HF_HUB_OFFLINE=1,FOO=deploy")
    client = llm_inference.LLMInferenceDirectClient.__new__(
        llm_inference.LLMInferenceDirectClient
    )
    client.slurm_account = None

    options = client._build_launch_options(env="FOO=request")

    assert ModelLauncher.__new__(ModelLauncher)._process_env_vars(options.env) == {
        "HF_HUB_OFFLINE": "1",
        "FOO": "request",
        "CUDA_VISIBLE_DEVICES": "$CUDA_VISIBLE_DEVICES",
    }


def test_container_env_flags_are_double_quoted():
    generator = SlurmScriptGenerator(
        {
            "num_nodes": 1,
            "venv": CONTAINER_MODULE_NAME,
            "model_name": "Qwen2.5-7B-Instruct",
            "model_weights_parent_dir": "/projects/modelcache/public",
            "env": {"FOO": 'a b"`\\', "CUDA_VISIBLE_DEVICES": "$CUDA_VISIBLE_DEVICES"},
        }
    )

    assert generator.env_str == (
        '--env "FOO=a b\\"\\`\\\\" '
        '--env "CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES"'
    )


def test_multi_gpu_container_launch_renders_one_env_flag_per_variable(monkeypatch):
    """Issue #56: the CUDA field must survive Apptainer's --env CSV parsing."""
    stale_workaround = (
        "HF_HOME=/root/.cache/huggingface,"
        '\\"CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES\\"'
    )
    monkeypatch.setattr(settings, "VEC_INF_ENV", stale_workaround)

    client = llm_inference.LLMInferenceDirectClient.__new__(
        llm_inference.LLMInferenceDirectClient
    )
    client.slurm_account = None
    options = client._build_launch_options(num_gpus=4, venv=CONTAINER_MODULE_NAME)

    env_dict = ModelLauncher.__new__(ModelLauncher)._process_env_vars(options.env)
    generator = SlurmScriptGenerator(
        {
            "num_nodes": 1,
            "venv": CONTAINER_MODULE_NAME,
            "model_name": "Qwen2.5-7B-Instruct",
            "model_weights_parent_dir": "/projects/modelcache/public",
            "env": env_dict,
        }
    )
    command = SLURM_SCRIPT_TEMPLATE["container_command"].format(
        env_str=generator.env_str, image_path=IMAGE_PATH["vllm"]
    )

    assert generator.env_str == (
        '--env "HF_HOME=/root/.cache/huggingface" '
        '--env "CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES"'
    )
    assert generator.env_str in command


FAKE_SBATCH = """#!/bin/sh
env > "$CAPTURE_DIR/env"
printf '%s\\n' "$@" > "$CAPTURE_DIR/argv"
cp "$1" "$CAPTURE_DIR/script"
echo "Submitted batch job 4242"
"""


def test_direct_launch_gives_the_key_to_the_job_and_nowhere_else(monkeypatch, tmp_path):
    """Runs vec-inf's real launch against a fake sbatch that records what it
    was given. The key must reach the job through its environment (sbatch
    exports it, Apptainer passes APPTAINERENV_* into the container) and must
    not appear in the job script, sbatch's arguments, or the files vec-inf
    leaves in the log directory, which other users may be able to read."""
    key = "deployment-key-0123456789"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    sbatch = bin_dir / "sbatch"
    sbatch.write_text(FAKE_SBATCH)
    sbatch.chmod(0o755)
    capture = tmp_path / "capture"
    capture.mkdir()
    weights = tmp_path / "weights"
    (weights / "Qwen2.5-0.5B-Instruct").mkdir(parents=True)
    log_dir = tmp_path / "logs"
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("CAPTURE_DIR", str(capture))
    monkeypatch.delenv(llm_inference._UPSTREAM_KEY_ENV, raising=False)

    result = llm_inference.LLMInferenceDirectClient().launch_model(
        "Qwen2.5-0.5B-Instruct",
        deployment_api_key=key,
        model_weights_parent_dir=str(weights),
        log_dir=str(log_dir),
        work_dir=str(tmp_path),
        num_gpus=1,
        partition="gpuA100x4",
        time="00:10:00",
        account="test-account",
    )

    assert result == {"success": True, "slurm_job_id": "4242", "job_id": "4242"}
    job_env = (capture / "env").read_text().splitlines()
    assert f"APPTAINERENV_VLLM_API_KEY={key}" in job_env
    argv = (capture / "argv").read_text()
    assert key not in argv
    # A future vec-inf adding --export=NONE would silently drop the key.
    assert "--export" not in argv
    assert key not in (capture / "script").read_text()
    for path in log_dir.rglob("*"):
        if path.is_file():
            assert key not in path.read_text(), path
    # Only the one submission saw it.
    assert llm_inference._UPSTREAM_KEY_ENV not in os.environ


def test_upstream_key_env_is_restored_after_a_launch(monkeypatch):
    monkeypatch.setenv(llm_inference._UPSTREAM_KEY_ENV, "operator-value")

    with llm_inference._upstream_key_in_environ("deployment-key"):
        assert os.environ[llm_inference._UPSTREAM_KEY_ENV] == "deployment-key"
    assert os.environ[llm_inference._UPSTREAM_KEY_ENV] == "operator-value"

    # A launch without a key must not inherit one left in the environment.
    with llm_inference._upstream_key_in_environ(None):
        assert llm_inference._UPSTREAM_KEY_ENV not in os.environ
    assert os.environ[llm_inference._UPSTREAM_KEY_ENV] == "operator-value"


def test_launch_shim_passes_the_payload_key_to_the_direct_client(
    monkeypatch, tmp_path, capsys
):
    from app.utils import vec_inf_launch_shim

    seen = {}

    class RecordingDirectClient:
        def launch_model(self, model_name, **kwargs):
            seen.update(kwargs, model_name=model_name)
            return {"success": True, "job_id": "1", "slurm_job_id": "1"}

    monkeypatch.setattr(
        vec_inf_launch_shim, "LLMInferenceDirectClient", RecordingDirectClient
    )
    payload = tmp_path / "payload.json"
    payload.write_text(
        json.dumps(
            {
                "model_name": "Qwen3-8B",
                "enable_cloudflare_tunnel": False,
                "params": {"num_gpus": 2},
                "deployment_api_key": "deployment-key-xyz",
            }
        )
    )
    monkeypatch.setattr("sys.argv", ["shim", str(payload)])

    assert vec_inf_launch_shim.main() == 0
    assert seen["deployment_api_key"] == "deployment-key-xyz"
    assert seen["num_gpus"] == 2
    assert not payload.exists()
