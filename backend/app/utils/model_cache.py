"""Keep the global model cache in sync with ``models.yaml``.

Run from cron (see ``scripts/sync_model_cache.py``). Every public model in
``models.yaml`` that declares ``hf_model`` is downloaded into vec-inf's
``model_weights_parent_dir`` under its model name, which is the layout vec-inf
expects, and weights for models that are no longer listed are deleted so the
cache tracks the config instead of growing until the disk fills.

Gated models are skipped for now. Staging them needs the restricted store and
the per-user hard-linking from the HF-gating PR, which is still being fixed;
downloading them into the public directory in the meantime would hand every
user weights they have not accepted the licence for. See the
``RE ADD AFTER GATED PR FIX`` markers below.
"""

import os
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

import yaml
from huggingface_hub import snapshot_download

from app.config.config import settings
from app.config.logging import get_logger
from app.utils.hf_auth import fetch_model_gating_status
from app.utils.infrastructure import InfrastructureManager

logger = get_logger("model_cache")

# Formats no engine we run loads; skipping them keeps the cache from doubling.
IGNORE_PATTERNS = ["*.h5", "*.msgpack", "original/*"]


def _as_path(value: Any) -> Optional[Path]:
    if not isinstance(value, str) or not value.strip():
        return None
    return Path(value.strip()).expanduser()


# RE ADD AFTER GATED PR FIX
# Restricted store for gated weights, and the per-user hard links launches make
# out of it. Re-adding _user_weight_dirs also needs get_vec_inf_log_base_dir
# back on the app.utils.infrastructure import above.
#
# def resolve_model_store_root() -> Optional[Path]:
#     """Return ``MODEL_STORE_ROOT``, the restricted store holding gated weights."""
#     return _as_path(getattr(settings, "MODEL_STORE_ROOT", None))
#
#
# def _user_weight_dirs(model_name: str) -> List[Path]:
#     """Return the per-user hard-link copies of ``model_name``.
#
#     Hard links keep the inodes alive after the store copy is gone, so removing
#     these is what actually frees the disk.
#     """
#     root = _as_path(
#         getattr(settings, "VEC_INF_SHARED_WORK_ROOT", None)
#         or get_vec_inf_log_base_dir()
#     )
#     if root is None or not root.is_dir():
#         return []
#     return [
#         path for path in root.glob(f"*/model-weights/{model_name}") if path.is_dir()
#     ]


def resolve_public_weights_root() -> Optional[Path]:
    """Return vec-inf's ``model_weights_parent_dir``, where public weights live."""
    environment = InfrastructureManager().get_environment_config() or {}
    default_args = environment.get("default_args") or {}
    return _as_path(default_args.get("model_weights_parent_dir"))


def resolve_models_config_path() -> Optional[Path]:
    """Return the ``models.yaml`` the backend runs with (mirrors ``app/main.py``)."""
    explicit = _as_path(
        os.getenv("VEC_INF_MODEL_CONFIG")
        or getattr(settings, "MODEL_CONFIG_PATH", None)
    )
    if explicit:
        return explicit

    manager = InfrastructureManager()
    infra_models = manager.get_config_path() / "models.yaml"
    if infra_models.exists():
        return infra_models

    shared_models = manager.config_dir / "models.yaml"
    return shared_models if shared_models.exists() else None


def load_models_config() -> Dict[str, Dict[str, Any]]:
    """Return the ``models:`` mapping from ``models.yaml``."""
    config_path = resolve_models_config_path()
    if config_path is None:
        raise RuntimeError("Could not locate models.yaml")

    with config_path.open() as file_obj:
        config = yaml.safe_load(file_obj) or {}
    logger.info("Loaded model config from %s", config_path)
    return config.get("models") or {}


def _prune_root(root: Path, expected: Set[str], dry_run: bool) -> List[str]:
    """Delete weight directories under ``root`` that ``models.yaml`` no longer lists.

    Only directories holding a ``config.json`` are touched, so the caches that
    share the directory with vec-inf (``huggingface``, ``torch_inductor``) and
    any hand-staged extras are left alone.
    """
    try:
        entries = sorted(root.iterdir())
    except OSError as exc:
        logger.error("Cannot prune %s: %s", root, exc)
        return []

    removed: List[str] = []
    for path in entries:
        if path.name in expected or not path.is_dir():
            continue
        if not (path / "config.json").exists():
            continue

        # RE ADD AFTER GATED PR FIX
        # Delete the per-user hard links too, or the inodes stay alive and no
        # disk is actually freed:
        # for link_dir in _user_weight_dirs(path.name):
        #     shutil.rmtree(link_dir, ignore_errors=True)
        logger.info("Removing stale weights %s", path)
        if not dry_run:
            shutil.rmtree(path, ignore_errors=True)
        removed.append(path.name)
    return removed


def sync_model_cache(dry_run: bool = False) -> Dict[str, List[str]]:
    """Download every public model listed in ``models.yaml`` and prune the rest."""
    public_root = resolve_public_weights_root()
    if public_root is None:
        raise RuntimeError(
            "Model cache is not configured: environment.yaml has no "
            "model_weights_parent_dir"
        )

    models = load_models_config()
    # Anything listed in models.yaml is kept, including models we skip below:
    # only weights for models that have been dropped from the config are pruned.
    expected: Set[str] = set(models)
    synced: List[str] = []
    skipped: List[str] = []
    failed: List[str] = []

    for model_name, model_config in sorted(models.items()):
        repo_id = (model_config or {}).get("hf_model")
        if not repo_id:
            logger.warning(
                "%s has no hf_model in models.yaml; cannot cache it", model_name
            )
            skipped.append(model_name)
            continue

        # RE ADD AFTER GATED PR FIX
        # Stage gated models into MODEL_STORE_ROOT instead of skipping them:
        # root = store_root if gated else public_root
        try:
            gated = fetch_model_gating_status(repo_id)
        except Exception as exc:
            # A lookup failure is not a public model: skip rather than risk
            # staging gated weights where every user can read them.
            logger.error("Could not check gating for %s: %s", repo_id, exc)
            skipped.append(model_name)
            continue

        if gated:
            logger.warning(
                "%s is gated; skipping until the restricted store is in use",
                model_name,
            )
            skipped.append(model_name)
            continue

        logger.info("Syncing %s from %s into %s", model_name, repo_id, public_root)
        if dry_run:
            synced.append(model_name)
            continue

        try:
            snapshot_download(
                repo_id=repo_id,
                local_dir=public_root / model_name,
                token=settings.HF_TOKEN,
                ignore_patterns=IGNORE_PATTERNS,
            )
            synced.append(model_name)
        except Exception as exc:
            logger.error("Failed to download %s (%s): %s", model_name, repo_id, exc)
            failed.append(model_name)

    removed = (
        _prune_root(public_root, expected, dry_run) if public_root.is_dir() else []
    )

    return {
        "synced": synced,
        "skipped": skipped,
        "failed": failed,
        "removed": removed,
    }
