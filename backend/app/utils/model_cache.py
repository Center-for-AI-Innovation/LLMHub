"""Evict models nobody has launched recently from the shared Hugging Face cache.

Run from cron (see ``scripts/clean_model_cache.py``). Models get into the cache
on their own: a launch whose weights are not on disk downloads them, so the
cache fills with what people actually use. This module is the other half --
deleting what has gone cold, so the cache does not grow until the disk fills.

The cache directory is taken from ``MODEL_CACHE_DIR`` (or ``--cache-dir``) and
never inferred: it differs per cluster, and a wrong guess here deletes the wrong
140GB. Deriving it from ``environment.yaml`` previously resolved to a personal
directory on a host where ``VEC_INF_CONFIG_DIR`` pointed somewhere absent.

"Used" comes from the ``ModelDeployment`` table, which records every launch and
is never purged. Cache entries are matched to it by exact Hugging Face repo id
(``AvailableModel.huggingfaceId``), not by name: discarding the org prefix would
let a hand-staged ``someone/Qwen3-8B`` inherit ``Qwen/Qwen3-8B``'s history and be
deleted. Filesystem access times are not used either -- ``/projects`` may be
mounted ``noatime``, which would make every model look permanently untouched.

A cached repo that matches nothing is left alone and reported. Those are
hand-staged (the shared cache is writable by users, see
``_ensure_shared_cache_dir_access``), renamed upstream (``CohereForAI/*`` became
``CohereLabs/*``), or dropped from ``models.yaml`` -- whose catalog row, and with
it the repo id mapping, is deleted by the model sync.
"""

from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from huggingface_hub import scan_cache_dir
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config.config import settings
from app.config.logging import get_logger
from app.models.available_model import AvailableModel
from app.models.model_deployment import ModelDeployment

logger = get_logger("model_cache")

# A model untouched for this long is evicted. Far longer than the 8h job cap, so
# a running job can never look stale.
DEFAULT_MAX_AGE_DAYS = 90


def resolve_cache_dir(override: Optional[str] = None) -> Path:
    """Return the HF cache directory to manage, from ``--cache-dir`` or settings."""
    raw = override or getattr(settings, "MODEL_CACHE_DIR", None)
    if not isinstance(raw, str) or not raw.strip():
        raise RuntimeError(
            "No model cache directory configured: set MODEL_CACHE_DIR in .env or "
            "pass --cache-dir. It is never inferred, because it differs per cluster."
        )

    cache_dir = Path(raw.strip()).expanduser()
    if not cache_dir.is_dir():
        raise RuntimeError(f"Model cache directory does not exist: {cache_dir}")
    return cache_dir


def last_launched_by_repo(db: Session) -> Dict[str, datetime]:
    """Return the most recent launch time per Hugging Face repo id.

    Deployments record a model name, so this joins through ``AvailableModel`` to
    get the repo id the cache is keyed by. Every launch writes a
    ``ModelDeployment`` row and nothing deletes them, so this is a complete
    history -- if a row-purging job is ever added, this stops being safe.
    """
    rows = (
        db.query(AvailableModel.huggingfaceId, func.max(ModelDeployment.createdAt))
        .join(ModelDeployment, ModelDeployment.modelId == AvailableModel.id)
        .filter(AvailableModel.huggingfaceId.isnot(None))
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
                "%s has no launch history (hand-staged, renamed, or dropped from "
                "models.yaml); leaving it alone -- %s",
                repo.repo_id,
                repo.size_on_disk_str,
            )
            unmatched.append(repo.repo_id)
            continue

        if launched_at > cutoff:
            kept.append(repo.repo_id)
            continue

        logger.info(
            "Evicting %s: last launched %s, %s on disk",
            repo.repo_id,
            launched_at.date(),
            repo.size_on_disk_str,
        )
        revisions.extend(revision.commit_hash for revision in repo.revisions)
        evicted.append(repo.repo_id)

    freed_bytes = 0
    if revisions:
        # Building the strategy is side-effect-free and reports the real freed
        # size, which per-repo sizes overstate (revisions share blobs).
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
