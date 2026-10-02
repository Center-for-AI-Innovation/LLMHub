#!/usr/bin/env python3
"""Delete models nobody has launched recently from the shared HF cache (cron job).

vLLM fills the cache when a launch downloads a model; this script empties it.
A model's last launch comes from ``ModelDeployment``, matched to cache entries by
exact HF repo id (``AvailableModel.huggingfaceId``). Cache entries with no
launch history are kept and reported. The compile cache (``COMPILE_CACHE_DIR``)
is keyed by hash, not model, so its directories are deleted by file age instead.
"""

import argparse
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from huggingface_hub import scan_cache_dir  # noqa: E402
from sqlalchemy import func  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.config.config import settings  # noqa: E402
from app.config.logging import get_logger  # noqa: E402
from app.models.available_model import AvailableModel  # noqa: E402
from app.models.model_deployment import ModelDeployment  # noqa: E402
from app.repositories.session import SessionLocal  # noqa: E402

logger = get_logger("evict_unused_models")

# Well above the 8h job limit, so a running model never looks unused.
DEFAULT_MAX_AGE_DAYS = 90


def resolve_cache_dir(override: Optional[str] = None) -> Path:
    """Return the cache directory from ``--cache-dir`` or ``MODEL_CACHE_DIR``."""
    raw = override or getattr(settings, "MODEL_CACHE_DIR", None)
    if not isinstance(raw, str) or not raw.strip():
        raise RuntimeError(
            "No model cache directory configured: set MODEL_CACHE_DIR in .env or "
            "pass --cache-dir. It is never inferred, because it differs per cluster."
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
    max_age_days: int = DEFAULT_MAX_AGE_DAYS,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Delete cached models whose last launch is older than ``max_age_days``."""
    logger.info("Scanning model cache %s", cache_dir)
    cache_info = scan_cache_dir(cache_dir)
    for warning in cache_info.warnings:
        logger.warning("Unreadable cache entry, skipped: %s", warning)

    last_launched = last_launched_by_repo(db)
    cutoff = datetime.utcnow() - timedelta(days=max_age_days)

    evicted: List[str] = []
    kept: List[str] = []
    unmatched: List[str] = []
    revisions: List[str] = []

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

        logger.info(
            ("Would evict" if dry_run else "Evicting")
            + " %s: last launched %s, %s on disk",
            repo.repo_id,
            launched_at.date(),
            repo.size_on_disk_str,
        )
        revisions.extend(revision.commit_hash for revision in repo.revisions)
        evicted.append(repo.repo_id)

    freed_bytes = 0
    if revisions:
        # Revisions share blobs, so the strategy's size is the real amount freed.
        strategy = cache_info.delete_revisions(*revisions)
        freed_bytes = strategy.expected_freed_size
        if not dry_run:
            strategy.execute()

    return {
        "evicted": evicted,
        "kept": kept,
        "unmatched": unmatched,
        "freed_bytes": freed_bytes,
    }


def evict_stale_compile_cache(
    cache_dir: Path,
    max_age_days: int = DEFAULT_MAX_AGE_DAYS,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Delete compile-cache dirs with no file read or written in ``max_age_days``."""
    cutoff = (datetime.now() - timedelta(days=max_age_days)).timestamp()
    removed = 0
    freed_bytes = 0
    emptied: Set[Path] = set()

    for dirpath, dirnames, filenames in os.walk(cache_dir, topdown=False):
        path = Path(dirpath)
        try:
            if filenames:
                stats = [(path / name).lstat() for name in filenames]
                if max(max(s.st_atime, s.st_mtime) for s in stats) >= cutoff:
                    continue
                removed += 1
                freed_bytes += sum(stat.st_size for stat in stats)
                if not dry_run:
                    for name in filenames:
                        (path / name).unlink()
            elif not dirnames and path.stat().st_mtime >= cutoff:
                continue  # may belong to a job that is still writing
            if path != cache_dir and all(path / name in emptied for name in dirnames):
                emptied.add(path)
                if not dry_run:
                    path.rmdir()
        except OSError as exc:
            logger.warning("Skipped %s: %s", path, exc)

    return {"removed": removed, "freed_bytes": freed_bytes}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--cache-dir",
        help="HF cache directory to clean (default: MODEL_CACHE_DIR from .env)",
    )
    parser.add_argument(
        "--compile-cache-dir",
        help="Compile cache directory to clean (default: COMPILE_CACHE_DIR from .env)",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=DEFAULT_MAX_AGE_DAYS,
        help=f"Evict entries unused for this many days (default: {DEFAULT_MAX_AGE_DAYS})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be evicted without deleting anything",
    )
    args = parser.parse_args()
    if args.days < 1:
        parser.error("--days must be at least 1")

    db = None
    compile_result = None
    try:
        cache_dir = resolve_cache_dir(args.cache_dir)
        compile_raw = args.compile_cache_dir or settings.COMPILE_CACHE_DIR
        compile_dir = resolve_cache_dir(compile_raw) if compile_raw else None
        db = SessionLocal()
        result = evict_unused_models(
            db, cache_dir, max_age_days=args.days, dry_run=args.dry_run
        )
        if compile_dir:
            compile_result = evict_stale_compile_cache(
                compile_dir, max_age_days=args.days, dry_run=args.dry_run
            )
    except Exception as exc:
        # Cron only sees the exit code, so log the reason.
        logger.error("Model eviction failed: %s", exc)
        return 1
    finally:
        if db is not None:
            db.close()

    suffix = " (dry run, nothing deleted)" if args.dry_run else ""
    logger.info(
        "Eviction complete on %s: evicted=%d kept=%d unmatched=%d freed=%.1fGB%s",
        cache_dir,
        len(result["evicted"]),
        len(result["kept"]),
        len(result["unmatched"]),
        result["freed_bytes"] / 1e9,
        suffix,
    )
    if compile_result is None:
        logger.info("COMPILE_CACHE_DIR not set; skipped the compile cache")
    else:
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
    return 0


if __name__ == "__main__":
    sys.exit(main())
