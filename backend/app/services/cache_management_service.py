"""Delete models nobody has launched recently from the shared HF cache.

Runs in the background service every ``MODEL_EVICTION_INTERVAL`` seconds.
Launches fill the cache when they download a model; this empties it. A model's
last launch comes from ``ModelDeployment``, matched to cache entries by exact HF
repo id (``AvailableModel.huggingfaceId``). Cache entries with no launch history
are kept and reported. Gated models in ``MODEL_STORE_ROOT`` are matched by folder
name instead. The compile cache (``COMPILE_CACHE_DIR``) is keyed by hash, not
model, so its directories are deleted by file age.
"""

import os
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from huggingface_hub import scan_cache_dir
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config.config import settings
from app.config.logging import get_logger
from app.models.available_model import AvailableModel
from app.models.model_deployment import ModelDeployment
from app.repositories.session import SessionLocal
from app.utils.llm_inference import (
    _PUBLIC_CACHE_COMPLETE_MARKER,
    _resolve_impersonated_workspace_root,
    _strip_group_other_write,
    public_model_download_state,
)

logger = get_logger("cache_management_service")


def resolve_cache_dir(override: Optional[str] = None) -> Path:
    """Return the cache directory from ``override`` or ``MODEL_CACHE_DIR``."""
    raw = override or getattr(settings, "MODEL_CACHE_DIR", None)
    if not isinstance(raw, str) or not raw.strip():
        raise RuntimeError(
            "No model cache directory configured: set MODEL_CACHE_DIR in .env. "
            "It is never inferred, because it differs per cluster."
        )

    cache_dir = Path(raw.strip()).expanduser()
    if not cache_dir.is_dir():
        raise RuntimeError(f"Cache directory does not exist: {cache_dir}")
    return cache_dir


def last_launched_by_repo(db: Session) -> Dict[str, datetime]:
    """Return the most recent launch time per HF repo id.

    Relies on ``ModelDeployment`` rows never being deleted.
    """
    rows = (
        db.query(AvailableModel.huggingfaceId, func.max(ModelDeployment.createdAt))
        .join(ModelDeployment, ModelDeployment.modelId == AvailableModel.id)
        .filter(
            AvailableModel.huggingfaceId.isnot(None),
            # Requests rejected before reaching Slurm never loaded the model.
            ModelDeployment.slurmJobId != "failed",
        )
        .group_by(AvailableModel.huggingfaceId)
        .all()
    )
    return {repo_id: launched_at for repo_id, launched_at in rows if launched_at}


def evict_unused_models(
    db: Session,
    cache_dir: Path,
    max_age_days: int,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Delete cached models whose last launch is older than ``max_age_days``."""
    logger.info("Scanning model cache %s", cache_dir)
    cache_info = scan_cache_dir(cache_dir)
    for warning in cache_info.warnings:
        logger.warning("Unreadable cache entry, skipped: %s", warning)

    last_launched = last_launched_by_repo(db)
    cutoff = datetime.utcnow() - timedelta(days=max_age_days)

    to_delete: List[Any] = []
    kept: List[str] = []
    unmatched: List[str] = []

    for repo in sorted(cache_info.repos, key=lambda repo: repo.repo_id):
        launched_at = last_launched.get(repo.repo_id)
        if launched_at is None:
            logger.info(
                "%s has no launch history; keeping it (%s)",
                repo.repo_id,
                repo.size_on_disk_str,
            )
            unmatched.append(repo.repo_id)
            continue

        if launched_at > cutoff:
            kept.append(repo.repo_id)
            continue

        if public_model_download_state(repo.repo_id)[0] == "downloading":
            # Launched again after the launch history above was read.
            kept.append(repo.repo_id)
            continue

        logger.info(
            ("Would evict" if dry_run else "Evicting")
            + " %s: last launched %s, %s on disk",
            repo.repo_id,
            launched_at.date(),
            repo.size_on_disk_str,
        )
        to_delete.append(repo)

    failed: List[str] = []
    if not dry_run:
        failed = [repo.repo_id for repo in to_delete if not _unmark_complete(repo)]
        to_delete = [repo for repo in to_delete if repo.repo_id not in failed]

    # Sized one model at a time, before deleting, so models that fail to delete
    # can be left out. A blob two evicted models share counts for neither, so
    # this errs low.
    sizes = {
        repo.repo_id: cache_info.delete_revisions(
            *(rev.commit_hash for rev in repo.revisions)
        ).expected_freed_size
        for repo in to_delete
    }

    if to_delete and not dry_run:
        cache_info.delete_revisions(
            *(rev.commit_hash for repo in to_delete for rev in repo.revisions)
        ).execute()
        # huggingface_hub logs a refused delete and carries on, so check.
        failed += [repo.repo_id for repo in to_delete if repo.repo_path.exists()]
        to_delete = [repo for repo in to_delete if repo.repo_id not in failed]
        # It also leaves shared-blob manifests world-writable again.
        try:
            _strip_group_other_write(cache_dir)
        except OSError as exc:
            logger.warning("Could not re-tighten %s: %s", cache_dir, exc)

    return {
        "evicted": [repo.repo_id for repo in to_delete],
        "kept": kept,
        "unmatched": unmatched,
        "failed": failed,
        "freed_bytes": sum(sizes[repo.repo_id] for repo in to_delete),
    }


def _unmark_complete(repo: Any) -> bool:
    """Make a model look not downloaded before deleting it.

    If the delete is then cut short, launches download it again instead of
    using it half-deleted. Returns False, and the model is skipped, when the
    marker can't be removed, so one stuck folder doesn't stop the rest.
    """
    try:
        (repo.repo_path / _PUBLIC_CACHE_COMPLETE_MARKER).unlink(missing_ok=True)
    except OSError as exc:
        logger.warning("Can't evict %s: %s", repo.repo_id, exc)
        return False
    return True


def last_launched_by_model(db: Session) -> Dict[str, datetime]:
    """Return the most recent launch time per model id."""
    rows = (
        db.query(ModelDeployment.modelId, func.max(ModelDeployment.createdAt))
        .filter(ModelDeployment.slurmJobId != "failed")
        .group_by(ModelDeployment.modelId)
        .all()
    )
    return {model_id: launched_at for model_id, launched_at in rows if launched_at}


def evict_unused_gated_models(
    db: Session,
    store_root: Path,
    max_age_days: int,
    dry_run: bool = False,
) -> Dict[str, List[str]]:
    """Delete gated models in ``MODEL_STORE_ROOT`` not launched in ``max_age_days``.

    Users' hard-linked copies are deleted too, since the space only comes back
    once every link is gone.
    """
    last_launched = last_launched_by_model(db)
    cutoff = datetime.utcnow() - timedelta(days=max_age_days)
    evicted: List[str] = []
    kept: List[str] = []
    unmatched: List[str] = []
    failed: List[str] = []

    for path in sorted(store_root.iterdir()):
        if path.is_symlink() or not path.is_dir() or path.name.endswith(".partial"):
            continue  # .partial: a download in progress, or one that will resume
        if path.name.endswith(".evicting"):
            logger.info(
                ("Would finish" if dry_run else "Finishing") + " deleting %s", path
            )
            if not dry_run:
                shutil.rmtree(path, ignore_errors=True)
            continue

        launched_at = last_launched.get(path.name)
        if launched_at is None:
            unmatched.append(path.name)
            continue
        if launched_at > cutoff:
            kept.append(path.name)
            continue

        logger.info(
            ("Would evict" if dry_run else "Evicting") + " gated %s: last launched %s",
            path.name,
            launched_at.date(),
        )
        _delete_user_copies(path.name, dry_run)
        if dry_run:
            evicted.append(path.name)
            continue
        # Renamed first: the model stops looking downloaded at once, and a delete
        # cut short is finished by the next run.
        evicting = path.with_name(path.name + ".evicting")
        try:
            path.rename(evicting)
        except OSError as exc:
            logger.warning("Can't evict %s: %s", path.name, exc)
            failed.append(path.name)
            continue
        shutil.rmtree(evicting, ignore_errors=True)
        (failed if evicting.exists() else evicted).append(path.name)

    return {"evicted": evicted, "kept": kept, "unmatched": unmatched, "failed": failed}


def _delete_user_copies(model_name: str, dry_run: bool) -> None:
    """Delete ``<workspace root>/<user>/model-weights/<model_name>`` for every user.

    Symlinks are never followed, so a user can't point the delete somewhere else.
    """
    root = _resolve_impersonated_workspace_root()
    if root is None:
        return
    try:
        user_dirs = sorted(root.iterdir())
    except OSError as exc:
        logger.warning("Can't look for users' copies of %s: %s", model_name, exc)
        return

    for user_dir in user_dirs:
        if user_dir.is_symlink():
            continue
        try:
            fd = os.open(
                user_dir / "model-weights",
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
            )
        except (FileNotFoundError, NotADirectoryError):
            continue
        except OSError as exc:
            logger.warning("Skipped %s: %s", user_dir, exc)
            continue
        copy = user_dir / "model-weights" / model_name
        try:
            os.stat(model_name, dir_fd=fd, follow_symlinks=False)
            logger.info(("Would delete" if dry_run else "Deleting") + " %s", copy)
            if not dry_run:
                shutil.rmtree(model_name, dir_fd=fd)
        except FileNotFoundError:
            pass
        except OSError as exc:
            logger.warning("Can't delete %s: %s", copy, exc)
        finally:
            os.close(fd)


def evict_stale_compile_cache(
    cache_dir: Path,
    max_age_days: int,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Delete compile-cache dirs with no file read or written in ``max_age_days``.

    Users can write to this cache, so every stat, unlink and rmdir goes through a
    handle on the directory being processed and never follows a symlink. Deleting
    by path would let a user swap a directory for a symlink mid-walk and have the
    service account delete files wherever it points.
    """
    cutoff = (datetime.now() - timedelta(days=max_age_days)).timestamp()
    removed = 0
    freed_bytes = 0
    emptied: Set[str] = set()

    walk = os.fwalk(cache_dir, topdown=False, follow_symlinks=False)
    for dirpath, dirnames, filenames, dirfd in walk:
        try:
            # Bottom-up, so emptied children are known; remove them through this
            # directory's handle, since a directory can't safely remove itself.
            for name in dirnames:
                if os.path.join(dirpath, name) in emptied and not dry_run:
                    os.rmdir(name, dir_fd=dirfd)

            if filenames:
                stats = [
                    os.stat(name, dir_fd=dirfd, follow_symlinks=False)
                    for name in filenames
                ]
                if max(max(s.st_atime, s.st_mtime) for s in stats) >= cutoff:
                    continue
                removed += 1
                freed_bytes += sum(stat.st_size for stat in stats)
                if not dry_run:
                    for name in filenames:
                        os.unlink(name, dir_fd=dirfd)
            elif not dirnames and os.stat(dirfd).st_mtime >= cutoff:
                continue  # may belong to a job that is still writing
            if all(os.path.join(dirpath, name) in emptied for name in dirnames):
                emptied.add(dirpath)  # the cache root is never removed: no parent
        except OSError as exc:
            logger.warning("Skipped %s: %s", dirpath, exc)

    return {"removed": removed, "freed_bytes": freed_bytes}


def run_eviction(max_age_days: int, dry_run: bool) -> None:
    """Clean the model cache, gated store and compile cache, and log what was done.

    Opens its own database session, so it is safe to call from a worker thread.
    """
    if max_age_days < 1:
        # 0 would make every model look unused and delete the whole cache.
        raise RuntimeError(f"max_age_days must be at least 1, got {max_age_days}")

    model_dir = resolve_cache_dir()
    store_root = None
    gated_result = None
    with SessionLocal() as db:
        result = evict_unused_models(db, model_dir, max_age_days, dry_run)
        if settings.MODEL_STORE_ROOT:
            # A missing or unreadable store must not stop the compile cache cleanup.
            try:
                store_root = resolve_cache_dir(settings.MODEL_STORE_ROOT)
                gated_result = evict_unused_gated_models(
                    db, store_root, max_age_days, dry_run
                )
            except (OSError, RuntimeError) as exc:
                logger.warning("Skipped gated models: %s", exc)

    # Checked only now: it is created on the first impersonated launch, and a
    # missing one must not stop the model cache from being cleaned.
    compile_dir = None
    compile_result = None
    if settings.COMPILE_CACHE_DIR:
        try:
            compile_dir = resolve_cache_dir(settings.COMPILE_CACHE_DIR)
        except RuntimeError as exc:
            logger.warning("Skipped the compile cache: %s", exc)
        else:
            compile_result = evict_stale_compile_cache(
                compile_dir, max_age_days, dry_run
            )

    suffix = " (dry run, nothing deleted)" if dry_run else ""
    logger.info(
        "Eviction complete on %s: evicted=%d kept=%d unmatched=%d failed=%d "
        "freed=%.1fGB%s",
        model_dir,
        len(result["evicted"]),
        len(result["kept"]),
        len(result["unmatched"]),
        len(result["failed"]),
        result["freed_bytes"] / 1e9,
        suffix,
    )
    if result["failed"]:
        logger.warning(
            "%d models could not be deleted and will be retried next run: %s",
            len(result["failed"]),
            ", ".join(result["failed"]),
        )
    if not settings.MODEL_STORE_ROOT:
        logger.info("MODEL_STORE_ROOT not set; skipped gated models")
    elif gated_result is not None:
        logger.info(
            "Gated model cleanup on %s: evicted=%d kept=%d unmatched=%d failed=%d%s",
            store_root,
            len(gated_result["evicted"]),
            len(gated_result["kept"]),
            len(gated_result["unmatched"]),
            len(gated_result["failed"]),
            suffix,
        )
        if gated_result["failed"]:
            logger.warning(
                "%d gated models could not be deleted and will be retried next "
                "run: %s",
                len(gated_result["failed"]),
                ", ".join(gated_result["failed"]),
            )
    if not settings.COMPILE_CACHE_DIR:
        logger.info("COMPILE_CACHE_DIR not set; skipped the compile cache")
    elif compile_result is not None:
        logger.info(
            "Compile cache cleanup on %s: removed=%d dirs freed=%.1fGB%s",
            compile_dir,
            compile_result["removed"],
            compile_result["freed_bytes"] / 1e9,
            suffix,
        )
    if result["unmatched"]:
        logger.warning(
            "%d cached models have no launch history and are never evicted: %s",
            len(result["unmatched"]),
            ", ".join(result["unmatched"]),
        )
