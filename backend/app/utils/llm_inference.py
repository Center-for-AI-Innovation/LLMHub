import json
import os
import pwd
import re
import shutil
import stat
import subprocess
import sys
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from huggingface_hub import snapshot_download
from huggingface_hub.file_download import repo_folder_name

from app.config.config import VecInfExecutionMode, settings
from app.config.logging import get_logger
from app.utils.cluster_users import normalize_cluster_username
from app.utils.infrastructure import get_vec_inf_log_base_dir
from app.utils.slurm_accounts import (
    list_user_slurm_accounts,
    select_user_slurm_account,
)

# IMPORTANT: Set VEC_INF env vars BEFORE importing vec-inf.
# vec-inf loads/caches config at import time.
PROJECT_ROOT = Path(__file__).resolve().parents[2]

settings.apply_vec_inf_environ()

# Python SDK for vec-inf (imported AFTER env vars are set)
from vec_inf.client.api import VecInfClient  # noqa: E402
from vec_inf.client.models import LaunchOptions  # noqa: E402

logger = get_logger("llm_inference")

_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]")
_select_user_slurm_account = select_user_slurm_account


def _grant_acl_access(path: Path, usernames: List[str], failure_context: str) -> None:
    """Grant each user rwx on ``path``, plus a default ACL for new entries."""
    for username in usernames:
        for extra_flags in ([], ["-d"]):
            command = ["setfacl", *extra_flags, "-m", f"u:{username}:rwx", str(path)]
            try:
                subprocess.run(command, text=True, capture_output=True, check=True)
            except FileNotFoundError as exc:
                raise RuntimeError(
                    f"Required ACL command not found: {command[0]}"
                ) from exc
            except subprocess.CalledProcessError as exc:
                stderr = (exc.stderr or "").strip()
                raise RuntimeError(
                    f"Failed to prepare {failure_context}: {stderr or exc}"
                ) from exc


def _restrict_acl_to_cluster_user(
    path: Path, cluster_username: str, directory: bool = False
) -> None:
    """Make ``path`` readable by the owner and ``cluster_username`` only.

    A file created inside the workspace inherits its default ACL, and the mode
    passed to open() becomes the ACL mask. 0600 masks the inherited
    ``user:<cluster_username>`` entry down to nothing, so the impersonated user
    can't read the file. Widening the mask alone would also expose the file to
    the inherited ``group::`` entry (a primary group shared by many accounts on
    Delta), so replace the whole ACL instead.
    """
    command = [
        "setfacl",
        "--set",
        (
            f"u::rwx,u:{cluster_username}:r-x,g::---,m::r-x,o::---"
            if directory
            else f"u::rw-,u:{cluster_username}:r--,g::---,m::r--,o::---"
        ),
        str(path),
    ]
    try:
        subprocess.run(command, text=True, capture_output=True, check=True)
    except FileNotFoundError as exc:
        raise RuntimeError(f"Required ACL command not found: {command[0]}") from exc
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or "").strip()
        raise RuntimeError(
            f"Failed to restrict {path} to {cluster_username}: {stderr or exc}"
        ) from exc


def _resolve_impersonated_workspace_root() -> Optional[Path]:
    raw_root = settings.resolve_workspace_root() or get_vec_inf_log_base_dir()
    if not isinstance(raw_root, str) or not raw_root.strip():
        return None
    return Path(raw_root).expanduser()


def _resolve_impersonated_workspace_dir(cluster_username: str) -> Optional[Path]:
    """Build the per-user workspace path. Expects a validated username."""
    root = _resolve_impersonated_workspace_root()
    if root is None:
        return None
    return root / cluster_username


def _ensure_log_dir_acl(cluster_username: str) -> None:
    """Grant the impersonated user (and service account) ACL on VEC_INF_LOG_DIR."""
    raw_log_dir = settings.VEC_INF_LOG_DIR
    if not isinstance(raw_log_dir, str) or not raw_log_dir.strip():
        return

    log_dir = Path(raw_log_dir).expanduser()
    log_dir.mkdir(parents=True, exist_ok=True)
    service_account = pwd.getpwuid(os.geteuid()).pw_name
    _grant_acl_access(
        log_dir,
        [cluster_username, service_account],
        f"log dir {log_dir} for {cluster_username}",
    )


def _ensure_impersonated_workspace_dir(cluster_username: str) -> Optional[Path]:
    """Create the per-user workspace and its ACLs. Expects a validated username."""
    workspace_dir = _resolve_impersonated_workspace_dir(cluster_username)
    if workspace_dir is None:
        return None

    workspace_dir.mkdir(parents=True, exist_ok=True)
    service_account = pwd.getpwuid(os.geteuid()).pw_name
    _grant_acl_access(
        workspace_dir,
        [cluster_username, service_account],
        f"workspace {workspace_dir} for {cluster_username}",
    )
    _ensure_log_dir_acl(cluster_username)

    return workspace_dir


def _get_shared_cache_dirs() -> List[Path]:
    return [
        Path(cache_dir).expanduser()
        for cache_dir in (settings.COMPILE_CACHE_DIR,)
        if cache_dir
    ]


def _ensure_shared_cache_dir_access(cluster_username: str) -> None:
    """Grant compile-cache write access, never model-cache write access."""
    service_account = pwd.getpwuid(os.geteuid()).pw_name
    for cache_dir in _get_shared_cache_dirs():
        cache_dir.mkdir(parents=True, exist_ok=True)
        _grant_acl_access(
            cache_dir,
            [cluster_username, service_account],
            f"shared cache dir {cache_dir} for {cluster_username}",
        )


def _join_contained(base: Path, relative: str, description: str) -> Path:
    """Join ``relative`` under ``base``, raising if it would escape ``base``.

    ``model_name`` is user-controlled (HF repo ids like ``org/model`` are
    expected and legitimately contain ``/``), so a character-class allowlist
    would either break normal names or still miss ``..`` traversal / a
    leading ``/`` (which pathlib's join treats as replacing ``base``
    entirely). Resolving and checking containment catches both.
    """
    base_resolved = base.resolve()
    candidate = (base / relative).resolve()
    if candidate != base_resolved and base_resolved not in candidate.parents:
        raise ValueError(
            f"{description} {relative!r} resolves outside {base} (got {candidate})"
        )
    return candidate


def _resolve_model_store_dir(model_name: str) -> Optional[Path]:
    """Return the shared store's directory for ``model_name``, if configured."""
    store_root = getattr(settings, "MODEL_STORE_ROOT", None)
    if not isinstance(store_root, str) or not store_root.strip():
        return None
    return _join_contained(Path(store_root).expanduser(), model_name, "model_name")


def _store_root_exposure(root: Path) -> Optional[str]:
    """Return why ``root`` is reachable by accounts other than root and us, or None.

    Reads the ACL rather than the mode: with an ACL, the mode's group bits are the
    mask, so a correctly private ``u:<service account>:rwx,g::---`` root would look
    group-writable. Owner, root and the service account may have access; the
    ``group::`` entry, ``other::`` and any other named user or group may not.
    """
    service_uid = os.geteuid()
    service_account = pwd.getpwuid(service_uid).pw_name
    owner_uid = root.stat().st_uid
    if owner_uid not in (0, service_uid):
        return f"owned by uid {owner_uid}"
    try:
        result = subprocess.run(
            ["getfacl", "-cpn", str(root)],
            text=True,
            capture_output=True,
            check=True,
        )
    except FileNotFoundError:
        mode = root.stat().st_mode & 0o777
        return f"mode {mode:o}" if mode & 0o077 else None

    entries = []
    mask = "rwx"
    for line in result.stdout.splitlines():
        line = line.split("#", 1)[0].strip()
        if not line or line.startswith("default:"):
            continue
        tag, qualifier, perms = line.split(":")
        if tag == "mask":
            mask = perms
        else:
            entries.append((tag, qualifier, perms))

    for tag, qualifier, perms in entries:
        if tag == "user" and qualifier in ("", "0", str(service_uid), service_account):
            continue
        effective = perms
        if tag == "group" or (tag == "user" and qualifier):
            effective = "".join(p if m != "-" else "-" for p, m in zip(perms, mask))
        if effective != "---":
            return f"{tag}:{qualifier}:{effective}"
    return None


def _check_store_root_private() -> None:
    """Create ``MODEL_STORE_ROOT`` owner-only if missing; refuse it if it isn't.

    Downloaded weights are world-readable (0644) so hard links work for the
    launching user; only this directory keeps everyone else out. A mkdir under
    the backend's umask 007 would leave it open to the service account's group,
    which on Delta is shared by many accounts.
    """
    store_root = getattr(settings, "MODEL_STORE_ROOT", None)
    if not isinstance(store_root, str) or not store_root.strip():
        return
    root = Path(store_root).expanduser()
    # Callers catch RuntimeError and record a failed deployment; anything else
    # (a failed mkdir, getfacl exiting non-zero, an ACL line we can't parse)
    # would otherwise surface as an HTTP 500.
    try:
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        exposure = _store_root_exposure(root)
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        raise RuntimeError(f"Cannot check MODEL_STORE_ROOT {root}: {exc}") from exc
    if exposure:
        raise RuntimeError(
            f"MODEL_STORE_ROOT {root} is open to other accounts ({exposure}); "
            "gated weights there would be readable by them. Restrict it to the "
            "service account (chmod 700, or an ACL with group::--- and other::---)."
        )


_downloads_in_progress: set = set()
# Why the last download for a key failed, until a new one starts.
_download_failures: Dict[str, str] = {}
_downloads_lock = threading.Lock()


def _claim_download(key: str) -> bool:
    """Mark ``key`` as downloading; return False if a download is already running."""
    with _downloads_lock:
        if key in _downloads_in_progress:
            return False
        _downloads_in_progress.add(key)
        _download_failures.pop(key, None)
        return True


def _finish_download(key: str, error: Optional[str]) -> None:
    with _downloads_lock:
        _downloads_in_progress.discard(key)
        if error is not None:
            _download_failures[key] = error


def _download_state(key: str, ready: bool) -> Tuple[str, Optional[str]]:
    """Return ``(state, error)``; state is ready, downloading, failed or missing.

    ``missing`` means neither the weights nor a running download are there, e.g.
    after a backend restart cut a download short.
    """
    if ready:
        return "ready", None
    with _downloads_lock:
        if key in _downloads_in_progress:
            return "downloading", None
        if key in _download_failures:
            return "failed", _download_failures[key]
    return "missing", None


def _download_gated_model(store_dir: Path, repo_id: str, hf_token: str) -> None:
    partial_dir = store_dir.with_name(store_dir.name + ".partial")
    error = None
    try:
        partial_dir.parent.mkdir(parents=True, exist_ok=True)
        # Reruns resume from partial_dir; original/ holds a duplicate raw checkpoint.
        snapshot_download(
            repo_id=repo_id,
            local_dir=partial_dir,
            token=hf_token,
            ignore_patterns=["original/*"],
        )
        shutil.rmtree(partial_dir / ".cache", ignore_errors=True)
        # Hard links share these inodes, so the launching user must be able to read them.
        # Access is limited by the store and each user's model-weights directory.
        for path in [partial_dir, *partial_dir.rglob("*")]:
            path.chmod(0o755 if path.is_dir() else 0o644)
        partial_dir.rename(store_dir)
        logger.info("Downloaded gated model %s into %s", repo_id, store_dir)
    except Exception as exc:
        logger.error("Gated model download failed for %s: %s", repo_id, exc)
        error = str(exc)
    finally:
        _finish_download(str(store_dir), error)


def start_gated_model_download(
    model_name: str, repo_id: Optional[str], hf_token: Optional[str]
) -> bool:
    """Start downloading a gated model missing from ``MODEL_STORE_ROOT``.

    Returns True when the launch has to wait for a download, False when there is
    nothing to download (already stored, or no store/repo/token to download
    with). Raises RuntimeError when the store can't be used.
    """
    try:
        store_dir = _resolve_model_store_dir(model_name)
    except ValueError:
        return False
    if store_dir is None or not repo_id or not hf_token:
        return False
    try:
        _check_store_root_private()
        if store_dir.is_dir():
            return False
    except (OSError, RuntimeError) as exc:
        logger.error("Refusing gated model download: %s", exc)
        raise RuntimeError(f"Cannot store gated model weights: {exc}") from exc

    if _claim_download(str(store_dir)):
        threading.Thread(
            target=_download_gated_model,
            args=(store_dir, repo_id, hf_token),
            daemon=True,
        ).start()
    return True


def gated_model_download_state(model_name: str) -> Tuple[str, Optional[str]]:
    """Where a gated model's download stands; see ``_download_state``.

    Reports ready when no store is configured, so the launch goes ahead and
    fails on the missing store with a clear message.
    """
    try:
        store_dir = _resolve_model_store_dir(model_name)
    except ValueError:
        return "ready", None
    if store_dir is None:
        return "ready", None
    try:
        ready = store_dir.is_dir()
    except OSError as exc:
        return "failed", f"Cannot read the protected model store: {exc}"
    return _download_state(str(store_dir), ready)


# Written into a repo's cache dir once a download finishes, so an interrupted one
# isn't mistaken for a complete model. Eviction deletes the repo dir and it with it.
_PUBLIC_CACHE_COMPLETE_MARKER = ".llmhub-complete"


def _strip_group_other_write(root: Path) -> None:
    """Remove group and other write from everything under ``root``.

    huggingface_hub creates lock files and shared-blob ``.refs`` manifests 0666 so
    several accounts can share a cache. This cache has one writer: a writable
    manifest lets anyone get a blob still in use collected by eviction, and a
    writable lock lets anyone stall downloads.
    """
    for path in [root, *root.rglob("*")]:
        if path.is_symlink():
            continue
        mode = stat.S_IMODE(path.stat().st_mode)
        if mode & 0o022:
            path.chmod(mode & ~0o022)


def _download_public_model(cache_dir: Path, repo_dir: Path, repo_id: str) -> None:
    error = None
    try:
        # token=False: never use the service account's own credential, so nothing
        # private or gated can land in the shared cache.
        snapshot_download(
            repo_id=repo_id,
            cache_dir=cache_dir,
            token=False,
            ignore_patterns=["original/*"],
        )
        _strip_group_other_write(cache_dir)
        (repo_dir / _PUBLIC_CACHE_COMPLETE_MARKER).touch()
        logger.info("Downloaded public model %s into %s", repo_id, cache_dir)
    except Exception as exc:
        logger.error("Public model download failed for %s: %s", repo_id, exc)
        error = str(exc)
    finally:
        _finish_download(str(repo_dir), error)


def _resolve_public_cache_repo_dir(
    repo_id: Optional[str],
) -> Optional[Tuple[Path, Path]]:
    """Return ``(cache_dir, repo_dir)`` for ``repo_id``, or None with no cache set.

    Raises ValueError for a repo id that would escape the cache.
    """
    cache_dir_setting = getattr(settings, "MODEL_CACHE_DIR", None)
    if not repo_id or not isinstance(cache_dir_setting, str):
        return None
    if not cache_dir_setting.strip():
        return None
    cache_dir = Path(cache_dir_setting).expanduser()
    repo_dir = _join_contained(
        cache_dir, repo_folder_name(repo_id=repo_id, repo_type="model"), "repo_id"
    )
    return cache_dir, repo_dir


def start_public_model_download(repo_id: Optional[str]) -> bool:
    """Start downloading a public model missing from ``MODEL_CACHE_DIR``.

    Jobs get the cache read-only and run offline, so the backend (as the service
    account) is the only thing that downloads into it. Returns True when the
    launch has to wait for a download, False when the model is already cached
    (or no cache/repo is configured, in which case jobs fetch their own
    weights). Raises RuntimeError when the cache can't be used.
    """
    try:
        dirs = _resolve_public_cache_repo_dir(repo_id)
    except ValueError as exc:
        raise RuntimeError(f"Invalid Hugging Face repo id: {exc}") from exc
    if dirs is None:
        return False
    cache_dir, repo_dir = dirs
    try:
        if (repo_dir / _PUBLIC_CACHE_COMPLETE_MARKER).is_file():
            return False
    except OSError as exc:
        logger.error("Cannot read model cache %s: %s", cache_dir, exc)
        raise RuntimeError(f"Cannot read the model cache: {exc}") from exc

    if _claim_download(str(repo_dir)):
        threading.Thread(
            target=_download_public_model,
            args=(cache_dir, repo_dir, repo_id),
            daemon=True,
        ).start()
    return True


def public_model_download_state(repo_id: Optional[str]) -> Tuple[str, Optional[str]]:
    """Where a public model's download stands; see ``_download_state``."""
    try:
        dirs = _resolve_public_cache_repo_dir(repo_id)
    except ValueError as exc:
        return "failed", f"Invalid Hugging Face repo id: {exc}"
    if dirs is None:
        return "ready", None
    _cache_dir, repo_dir = dirs
    try:
        ready = (repo_dir / _PUBLIC_CACHE_COMPLETE_MARKER).is_file()
    except OSError as exc:
        return "failed", f"Cannot read the model cache: {exc}"
    return _download_state(str(repo_dir), ready)


def _hardlink_tree(src: Path, dst: Path) -> None:
    """Recreate ``src`` under ``dst``, hard-linking each file.

    Hard links are per-file (POSIX has no directory hard link), so this walks
    the source tree and links files individually, creating directories as
    needed. Existing destination files are left as-is, so this is safe to
    call repeatedly (e.g. once per launch) without redoing finished work.
    """
    for root, _dirnames, filenames in os.walk(src):
        rel_dir = Path(root).relative_to(src)
        dest_dir = dst / rel_dir
        dest_dir.mkdir(parents=True, exist_ok=True)
        for filename in filenames:
            dest_file = dest_dir / filename
            if dest_file.exists():
                continue
            try:
                os.link(Path(root) / filename, dest_file)
            except FileExistsError:
                pass


def resolve_gated_model_store_dir(model_name: str) -> Path:
    """Return ``MODEL_STORE_ROOT`` to launch a direct-mode gated model from.

    Direct (non-impersonated) execution always runs as the service account,
    which already has its own access to the protected ``MODEL_STORE_ROOT``
    (e.g. via ACL) -- unlike impersonated launches, no per-user hard-linked
    copy is needed here. Requires the model to already be staged in the
    store; callers must not fall back to the infrastructure-wide default
    ``model_weights_parent_dir``, which is typically world-readable and would
    defeat gating for anyone with plain filesystem access.
    """
    store_root = getattr(settings, "MODEL_STORE_ROOT", None)
    try:
        source_dir = _resolve_model_store_dir(model_name)
    except ValueError as exc:
        raise RuntimeError(f"Invalid model name for shared model store: {exc}") from exc
    if source_dir is None:
        raise RuntimeError(
            "MODEL_STORE_ROOT is not set; gated models can only launch from the "
            "protected model store"
        )
    _check_store_root_private()
    try:
        staged = source_dir.is_dir()
    except OSError as exc:
        raise RuntimeError(f"Cannot read the protected model store: {exc}") from exc
    if not staged:
        raise RuntimeError(
            f"Model {model_name!r} not found in the protected model store "
            f"(MODEL_STORE_ROOT={store_root!r}); direct-mode gated launches "
            "require pre-staged weights rather than falling back to the "
            "shared/world-readable default cache."
        )
    return Path(store_root).expanduser()


def ensure_gated_model_weights_for_user(cluster_username: str, model_name: str) -> Path:
    """Hard-link ``model_name`` from the shared store into ``cluster_username``'s
    workspace and return the per-user ``model_weights_parent_dir`` to launch with.

    Hard links share the underlying inode with the store copy, so this costs no
    extra storage quota. Only meaningful for impersonated (per-user) launches --
    for direct/shared execution, use ``resolve_gated_model_store_dir`` instead,
    since the service account can read the protected store directly. Expects an
    already-validated username.
    """
    try:
        source_dir = _resolve_model_store_dir(model_name)
    except ValueError as exc:
        raise RuntimeError(f"Invalid model name for shared model store: {exc}") from exc
    if source_dir is None:
        raise RuntimeError(
            "MODEL_STORE_ROOT is not set; gated models can only launch from the "
            "protected model store"
        )
    _check_store_root_private()
    try:
        staged = source_dir.is_dir()
    except OSError as exc:
        raise RuntimeError(f"Cannot read the shared model store: {exc}") from exc
    if not staged:
        raise RuntimeError(
            f"Model {model_name!r} not found in the shared model store "
            f"(MODEL_STORE_ROOT={getattr(settings, 'MODEL_STORE_ROOT', None)!r})"
        )

    try:
        workspace_dir = _ensure_impersonated_workspace_dir(cluster_username)
        if workspace_dir is None:
            raise RuntimeError(
                "Cannot prepare user-scoped model weights: no impersonated "
                "workspace root configured (VEC_INF_SHARED_WORK_ROOT / vec-inf "
                "log dir)"
            )

        weights_parent_dir = workspace_dir / "model-weights"
        # The workspace's owning group is shared by many accounts; keep it out of
        # the links.
        weights_parent_dir.mkdir(exist_ok=True)
        _restrict_acl_to_cluster_user(
            weights_parent_dir, cluster_username, directory=True
        )
        try:
            dest_dir = _join_contained(weights_parent_dir, model_name, "model_name")
        except ValueError as exc:
            raise RuntimeError(f"Invalid model name for user workspace: {exc}") from exc
        _hardlink_tree(source_dir, dest_dir)
    except OSError as exc:
        # os.link raises EXDEV when MODEL_STORE_ROOT and the workspace root are on
        # different filesystems; hard links need both on the same one.
        raise RuntimeError(
            f"Failed to link {model_name!r} into {cluster_username}'s workspace: "
            f"{exc}"
        ) from exc
    return weights_parent_dir


def _get_impersonation_python() -> str:
    configured = settings.VEC_INF_IMPERSONATE_PYTHON
    if isinstance(configured, str) and configured.strip():
        return configured.strip()
    return sys.executable


def _should_inject_project_pythonpath() -> bool:
    configured = settings.VEC_INF_IMPERSONATE_PYTHON
    return not (isinstance(configured, str) and configured.strip())


def _impersonation_wrapper_command(cluster_username: str, *command: str) -> List[str]:
    """Build the sudo wrapper invocation.

    Always pass ``--no-login-shell`` so the impersonated user's bashrc/profile
    cannot alter the launch environment.
    """
    wrapper_path = Path(settings.VEC_INF_IMPERSONATE_SCRIPT)
    return [
        str(wrapper_path),
        "--no-login-shell",
        cluster_username,
        "--",
        *command,
    ]


class LLMInferenceDirectClient:
    """Direct vec-inf client used both locally and inside the launch shim."""

    def __init__(self):
        vec_inf_config_dir = settings.VEC_INF_CONFIG_DIR
        if vec_inf_config_dir:
            logger.info("Using VEC_INF_CONFIG_DIR: %s", vec_inf_config_dir)
            self._verify_config_files(vec_inf_config_dir)
        else:
            logger.info(
                "VEC_INF_CONFIG_DIR not set, using vec-inf default config location"
            )

        # MODEL_CONFIG_PATH / VEC_INF_MODEL_CONFIG can override models.yaml
        config_path = settings.VEC_INF_MODEL_CONFIG or settings.MODEL_CONFIG_PATH
        if config_path:
            logger.info("Using custom model config path: %s", config_path)
            if not os.environ.get("VEC_INF_MODEL_CONFIG"):
                os.environ["VEC_INF_MODEL_CONFIG"] = str(config_path)
                logger.info("Set VEC_INF_MODEL_CONFIG to: %s", config_path)

        # Initialize VecInfClient - it will use VEC_INF_CONFIG_DIR if set
        self.client = VecInfClient()
        self.slurm_account = settings.SLURM_ACCOUNT or settings.VEC_INF_ACCOUNT

    @staticmethod
    def _ensure_cuda_visible_devices_env(env_value: Optional[str]) -> str:
        """Ensure we pass Slurm-assigned GPUs into the container."""
        cuda_kv = "CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES"
        if not env_value:
            return cuda_kv

        if "CUDA_VISIBLE_DEVICES=" in env_value:
            return env_value

        return f"{env_value},{cuda_kv}"

    def _build_launch_options(self, **params: Optional[Union[str, int, bool]]):
        """Map API payload params to LaunchOptions."""
        mapped: Dict[str, Any] = {}

        if params.get("num_nodes") is not None:
            mapped["num_nodes"] = params["num_nodes"]
        if params.get("num_gpus") is not None:
            mapped["gpus_per_node"] = params["num_gpus"]
        if params.get("partition") is not None:
            mapped["partition"] = params["partition"]
        if params.get("qos") is not None:
            mapped["qos"] = params["qos"]
        if params.get("time") is not None:
            time_value = params["time"]
            if isinstance(time_value, int):
                hours = time_value // 3600
                minutes = (time_value % 3600) // 60
                seconds = time_value % 60
                mapped["time"] = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
                logger.info(
                    "Converted time from %s seconds to %s", time_value, mapped["time"]
                )
            elif isinstance(time_value, str):
                mapped["time"] = time_value
            else:
                mapped["time"] = str(time_value)
        if params.get("data_type") is not None:
            mapped["data_type"] = params["data_type"]
        if params.get("resource_type") is not None:
            mapped["resource_type"] = params["resource_type"]
        if params.get("venv") is not None:
            mapped["venv"] = params["venv"]
        elif settings.DEFAULT_VENV:
            mapped["venv"] = settings.DEFAULT_VENV

        if params.get("work_dir") is not None:
            mapped["work_dir"] = params["work_dir"]
        if params.get("log_dir") is not None:
            mapped["log_dir"] = params["log_dir"]

        if params.get("account") is not None:
            mapped["account"] = params["account"]
        elif self.slurm_account:
            mapped["account"] = self.slurm_account
            logger.info("Using SLURM account from environment: %s", self.slurm_account)

        vllm_parts: List[str] = []
        if params.get("max_model_len") is not None:
            vllm_parts.append(f"--max-model-len={params['max_model_len']}")
        if params.get("max_num_seqs") is not None:
            vllm_parts.append(f"--max-num-seqs={params['max_num_seqs']}")
        # Client vllm_args are dropped upstream; vec-inf still needs the parallel
        # sizes to match an explicit GPU/node request (TP within a node, PP across).
        if params.get("num_gpus") is not None:
            vllm_parts.append(f"--tensor-parallel-size={int(params['num_gpus'])}")
        if params.get("num_nodes") is not None:
            vllm_parts.append(f"--pipeline-parallel-size={int(params['num_nodes'])}")
        if params.get("vllm_args") is not None:
            vllm_parts.append(params["vllm_args"])
        if vllm_parts:
            mapped["vllm_args"] = ",".join(vllm_parts)

        if params.get("hf_model") is not None:
            mapped["hf_model"] = params["hf_model"]

        if params.get("model_weights_parent_dir") is not None:
            mapped["model_weights_parent_dir"] = params["model_weights_parent_dir"]

        env_value = params.get("env") or settings.VEC_INF_ENV
        mapped["env"] = self._ensure_cuda_visible_devices_env(env_value)

        return LaunchOptions(**mapped)

    def launch_model(
        self, model_name: str, enable_cloudflare_tunnel: bool = False, **params
    ):
        """Launch a model using the vec-inf Python API."""
        # SDK tunnel support is handled externally for now.
        _ = enable_cloudflare_tunnel
        try:
            options = self._build_launch_options(**params)
            resp = self.client.launch_model(model_name, options=options)
            slurm_job_id = getattr(resp, "slurm_job_id", None)
            logger.info("Launched model %s -> %s", model_name, slurm_job_id)
            return {
                "success": True,
                "slurm_job_id": slurm_job_id,
                "job_id": slurm_job_id,
            }
        except Exception as exc:
            logger.error("Failed to launch model: %s", exc)
            return {"success": False, "error": str(exc)}

    def get_model_status(self, slurm_job_id: str):
        try:
            status = self.client.get_status(slurm_job_id)
            server_status = getattr(status, "server_status", None)
            status_str = getattr(server_status, "value", None) or str(server_status)
            base_url = getattr(status, "base_url", None)
            return {
                "success": True,
                "status": status_str,
                "endpoint_ready": bool(base_url),
                "endpoint_url": base_url,
                "model_name": getattr(status, "model_name", None),
                "pending_reason": getattr(status, "pending_reason", None),
                "failed_reason": getattr(status, "failed_reason", None),
                "job_state": getattr(status, "job_state", None),
            }
        except Exception as exc:
            logger.error("Failed to get model status: %s", exc)
            return {"success": False, "error": str(exc)}

    def get_model_metrics(self, slurm_job_id: str):
        try:
            metrics = self.client.get_metrics(slurm_job_id)
            return {
                "success": True,
                **(metrics if isinstance(metrics, dict) else {"metrics": metrics}),
            }
        except Exception as exc:
            logger.error("Failed to get model metrics: %s", exc)
            return {"success": False, "error": str(exc)}

    def shutdown_model(self, slurm_job_id: str):
        try:
            result = self.client.shutdown_model(slurm_job_id)
            return {"success": True, "result": result}
        except Exception as exc:
            logger.error("Failed to shutdown model: %s", exc)
            return {"success": False, "error": str(exc)}

    def list_available_models(self):
        # Prefer models defined in the infrastructure models.yaml;
        # fall back to vec-inf's merged/default list if not found.
        try:
            user_config_path = self._resolve_user_models_config_path()
            if user_config_path:
                import yaml as _yaml

                with open(user_config_path) as fh:
                    raw = _yaml.safe_load(fh) or {}
                names = list(raw.get("models", {}).keys())
                logger.info(
                    "Loaded %d models from infrastructure config: %s",
                    len(names),
                    user_config_path,
                )
                return {"success": True, "models": names}

            # Fallback: no user config found, defer to vec-inf's merged list
            logger.warning(
                "No infrastructure models.yaml found; falling back to vec-inf default model list"
            )
            models = self.client.list_models()
            try:
                names = [getattr(model, "name", str(model)) for model in models]
                return {"success": True, "models": names}
            except Exception:
                return {"success": True, "models": models}
        except Exception as exc:
            logger.error("Failed to list available models: %s", exc)
            return {"success": False, "error": str(exc)}

    def _resolve_user_models_config_path(self) -> Optional[str]:
        """Return the path to the infrastructure-specific models.yaml, or None."""
        explicit = settings.VEC_INF_MODEL_CONFIG or settings.MODEL_CONFIG_PATH
        if explicit and Path(explicit).exists():
            return explicit

        config_dir = settings.VEC_INF_CONFIG_DIR
        if config_dir:
            candidate = Path(config_dir) / "models.yaml"
            if candidate.exists():
                return str(candidate)

        return None

    def get_model_details(self, model_name: str):
        try:
            details = self.client.get_model_config(model_name)
            return {"success": True, "details": details}
        except Exception as exc:
            logger.error("Failed to get model details: %s", exc)
            return {"success": False, "error": str(exc)}

    def _verify_config_files(self, config_dir: str):
        """Verify that environment.yaml and models.yaml exist in the config directory."""
        config_path = Path(config_dir)
        env_file = config_path / "environment.yaml"
        models_file = config_path / "models.yaml"

        if env_file.exists():
            logger.info("Found environment.yaml at: %s", env_file)
        else:
            logger.warning("environment.yaml not found at: %s", env_file)

        if models_file.exists():
            logger.info("Found models.yaml at: %s", models_file)
        else:
            model_config_override = (
                settings.VEC_INF_MODEL_CONFIG or settings.MODEL_CONFIG_PATH
            )
            if model_config_override and Path(model_config_override).exists():
                logger.info(
                    "models.yaml not found at: %s; using model config override at: %s",
                    models_file,
                    model_config_override,
                )
            else:
                logger.warning("models.yaml not found at: %s", models_file)

    def get_tunnel_url(
        self,
        job_name: str,
        slurm_job_id: str,
        cluster_username: Optional[str] = None,
    ):
        """Get the Cloudflare tunnel URL for a deployed model."""
        if cluster_username:
            try:
                cluster_username = normalize_cluster_username(cluster_username)
            except ValueError as exc:
                logger.error("Cannot resolve tunnel URL: %s", exc)
                return None
            workspace_dir = _resolve_impersonated_workspace_dir(cluster_username)
            log_base = str(workspace_dir) if workspace_dir else None
        else:
            log_base = get_vec_inf_log_base_dir()
        if not log_base:
            logger.error("Vec-inf log directory not configured")
            return None
        tunnel_url_file = os.path.join(
            log_base, f"{job_name}.{slurm_job_id}.tunnel_url"
        )
        try:
            if os.path.exists(tunnel_url_file):
                with open(tunnel_url_file, "r") as file_obj:
                    tunnel_url = file_obj.read().strip()
                    logger.info("Found tunnel URL: %s", tunnel_url)
                    return tunnel_url
            logger.warning("Tunnel URL file not found: %s", tunnel_url_file)
            return None
        except Exception as exc:
            logger.error("Error reading tunnel URL file: %s", exc)
            return None


class LLMInferenceClient:
    """Launch wrapper that can impersonate the submitting cluster user."""

    def __init__(self):
        self.execution_mode = settings.VEC_INF_EXECUTION_MODE
        self.direct_client = LLMInferenceDirectClient()

    @staticmethod
    def _build_launch_payload(
        model_name: str,
        enable_cloudflare_tunnel: bool,
        params: Dict[str, Any],
    ) -> str:
        return json.dumps(
            {
                "model_name": model_name,
                "enable_cloudflare_tunnel": enable_cloudflare_tunnel,
                "params": params,
            }
        )

    @staticmethod
    def _prepend_pythonpath(env: Dict[str, str]) -> Dict[str, str]:
        project_root = str(PROJECT_ROOT)
        pythonpath = env.get("PYTHONPATH")
        if not pythonpath:
            env["PYTHONPATH"] = project_root
        else:
            parts = pythonpath.split(os.pathsep)
            if project_root not in parts:
                env["PYTHONPATH"] = os.pathsep.join([project_root, pythonpath])
        return env

    @staticmethod
    def _parse_impersonated_response(stdout: str, stderr: str) -> Dict[str, Any]:
        for line in reversed(
            [item.strip() for item in stdout.splitlines() if item.strip()]
        ):
            line = _CONTROL_CHARS_RE.sub("", line)
            if "{" in line and "}" in line:
                line = line[line.find("{") : line.rfind("}") + 1]
            try:
                parsed = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict):
                return parsed

        error_parts = []
        if stderr.strip():
            error_parts.append(stderr.strip())
        if stdout.strip():
            error_parts.append(stdout.strip())
        error = (
            "\n".join(error_parts)
            if error_parts
            else "Impersonated launch returned no JSON payload"
        )
        return {"success": False, "error": error}

    def _launch_model_impersonated(
        self,
        model_name: str,
        enable_cloudflare_tunnel: bool,
        cluster_username: Optional[str],
        **params,
    ):
        if not cluster_username:
            return {
                "success": False,
                "error": "Cluster username is required when impersonation mode is enabled",
            }
        try:
            cluster_username = normalize_cluster_username(cluster_username)
        except ValueError as exc:
            return {"success": False, "error": str(exc)}

        params = dict(params)
        wrapper_path = Path(settings.VEC_INF_IMPERSONATE_SCRIPT)
        if not wrapper_path.exists():
            return {
                "success": False,
                "error": f"Impersonation wrapper not found: {wrapper_path}",
            }

        try:
            workspace_dir = _ensure_impersonated_workspace_dir(cluster_username)
            _ensure_shared_cache_dir_access(cluster_username)
            if workspace_dir is not None:
                # These keys arrive from model_dump() already present and set to
                # None, so setdefault() would never fire.
                if not params.get("work_dir"):
                    params["work_dir"] = str(workspace_dir)
                if not params.get("log_dir"):
                    params["log_dir"] = str(workspace_dir)

            requested_account = params.get("account")
            if requested_account:
                accounts = list_user_slurm_accounts(cluster_username)
                if requested_account not in accounts:
                    raise RuntimeError(
                        f"Slurm account {requested_account!r} is not associated "
                        f"with {cluster_username}"
                    )
            else:
                prefer_gpu = params.get("num_gpus", 1) != 0
                params["account"] = _select_user_slurm_account(
                    cluster_username,
                    prefer_gpu=prefer_gpu,
                )
        except RuntimeError as exc:
            return {"success": False, "error": str(exc)}

        if workspace_dir is None:
            return {
                "success": False,
                "error": (
                    "Cannot prepare impersonated launch: no workspace directory "
                    "configured (VEC_INF_SHARED_WORK_ROOT / vec-inf log dir)"
                ),
            }

        # Pass the payload as a file, not on the command line: arguments are visible
        # to any user on the host via `ps`/`/proc/<pid>/cmdline`. It no longer carries
        # the HF token (launches keep it out of the job, see launch_model), so this is
        # defense in depth. The file lands in the impersonated user's workspace.
        payload = self._build_launch_payload(
            model_name, enable_cloudflare_tunnel, params
        )
        payload_path = workspace_dir / f".launch-payload-{uuid.uuid4().hex}.json"
        fd = os.open(str(payload_path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            _restrict_acl_to_cluster_user(payload_path, cluster_username)
        except RuntimeError as exc:
            os.close(fd)
            payload_path.unlink(missing_ok=True)
            return {"success": False, "error": str(exc)}
        with os.fdopen(fd, "w") as f:
            f.write(payload)

        try:
            command = _impersonation_wrapper_command(
                cluster_username,
                _get_impersonation_python(),
                "-m",
                "app.utils.vec_inf_launch_shim",
                str(payload_path),
            )

            env = os.environ.copy()
            if _should_inject_project_pythonpath():
                env = self._prepend_pythonpath(env)
            if settings.VEC_INF_ENV:
                env["VEC_INF_ENV"] = str(settings.VEC_INF_ENV)
            env["VEC_INF_LOG_DIR"] = str(workspace_dir)
            env["VEC_INF_WORK_DIR"] = str(params.get("work_dir") or workspace_dir)
            if params.get("account"):
                env["VEC_INF_ACCOUNT"] = str(params["account"])
                env["SLURM_ACCOUNT"] = str(params["account"])
            # Do not use PROJECT_ROOT as cwd: Settings(env_file=".env") would try to
            # open the service account's unreadable .env as svcllmhub*. Imports come
            # from VEC_INF_IMPERSONATE_PYTHON's site-packages (or PYTHONPATH).
            result = subprocess.run(
                command,
                text=True,
                capture_output=True,
                env=env,
                cwd=str(workspace_dir),
            )
        finally:
            payload_path.unlink(missing_ok=True)

        parsed = self._parse_impersonated_response(result.stdout, result.stderr)
        if result.returncode != 0 and parsed.get("success", True):
            parsed = {
                "success": False,
                "error": parsed.get("error")
                or f"Impersonated launch failed with code {result.returncode}",
            }
        return parsed

    def _shutdown_model_impersonated(
        self,
        slurm_job_id: str,
        cluster_username: Optional[str],
    ):
        """
        Cancel a Slurm job as impersonated user
        """
        if not cluster_username:
            return {
                "success": False,
                "error": "Cluster username is required when impersonation mode is enabled",
            }
        try:
            cluster_username = normalize_cluster_username(cluster_username)
        except ValueError as exc:
            return {"success": False, "error": str(exc)}

        wrapper_path = Path(settings.VEC_INF_IMPERSONATE_SCRIPT)
        if not wrapper_path.exists():
            return {
                "success": False,
                "error": f"Impersonation wrapper not found: {wrapper_path}",
            }

        command = _impersonation_wrapper_command(
            cluster_username, "scancel", str(slurm_job_id)
        )

        workspace_dir = _resolve_impersonated_workspace_dir(cluster_username)
        result = subprocess.run(
            command,
            text=True,
            capture_output=True,
            cwd=str(workspace_dir or Path.cwd()),
        )

        if result.returncode != 0:
            error = (result.stderr or "").strip() or (result.stdout or "").strip()
            return {
                "success": False,
                "error": error
                or f"Impersonated scancel failed with code {result.returncode}",
            }
        return {"success": True}

    def launch_model(
        self,
        model_name: str,
        enable_cloudflare_tunnel: bool = False,
        cluster_username: Optional[str] = None,
        **params,
    ):
        if self.execution_mode == VecInfExecutionMode.IMPERSONATE:
            return self._launch_model_impersonated(
                model_name,
                enable_cloudflare_tunnel=enable_cloudflare_tunnel,
                cluster_username=cluster_username,
                **params,
            )
        return self.direct_client.launch_model(
            model_name,
            enable_cloudflare_tunnel=enable_cloudflare_tunnel,
            **params,
        )

    def get_model_status(self, slurm_job_id: str):
        return self.direct_client.get_model_status(slurm_job_id)

    def get_model_metrics(self, slurm_job_id: str):
        return self.direct_client.get_model_metrics(slurm_job_id)

    def shutdown_model(self, slurm_job_id: str, cluster_username: Optional[str] = None):
        if self.execution_mode == VecInfExecutionMode.IMPERSONATE:
            return self._shutdown_model_impersonated(slurm_job_id, cluster_username)
        return self.direct_client.shutdown_model(slurm_job_id)

    def list_available_models(self):
        return self.direct_client.list_available_models()

    def get_model_details(self, model_name: str):
        return self.direct_client.get_model_details(model_name)

    def get_tunnel_url(
        self,
        job_name: str,
        slurm_job_id: str,
        cluster_username: Optional[str] = None,
    ):
        return self.direct_client.get_tunnel_url(
            job_name,
            slurm_job_id,
            cluster_username=cluster_username,
        )
