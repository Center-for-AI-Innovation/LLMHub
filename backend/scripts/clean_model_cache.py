#!/usr/bin/env python3
"""Evict unused models from the shared HF cache. Intended to run from cron."""

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.config.logging import get_logger  # noqa: E402
from app.repositories.session import SessionLocal  # noqa: E402
from app.utils.model_cache import (  # noqa: E402
    DEFAULT_MAX_AGE_DAYS,
    evict_unused_models,
    resolve_cache_dir,
)

logger = get_logger("clean_model_cache")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cache-dir",
        help="HF cache directory to clean (default: MODEL_CACHE_DIR from .env)",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=DEFAULT_MAX_AGE_DAYS,
        help=f"Evict models unused for this many days (default: {DEFAULT_MAX_AGE_DAYS})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be evicted without deleting anything",
    )
    args = parser.parse_args()

    db = None
    try:
        cache_dir = resolve_cache_dir(args.cache_dir)
        db = SessionLocal()
        result = evict_unused_models(
            db, cache_dir, max_age_days=args.days, dry_run=args.dry_run
        )
    except Exception as exc:
        # Includes a missing/unreadable cache dir, a corrupt cache, and any
        # database failure. Cron only sees the exit code, so say what happened.
        logger.error("Model cache cleanup failed: %s", exc)
        return 1
    finally:
        if db is not None:
            db.close()

    logger.info(
        "Cleanup complete on %s: evicted=%d kept=%d unmatched=%d freed=%.1fGB%s",
        cache_dir,
        len(result["evicted"]),
        len(result["kept"]),
        len(result["unmatched"]),
        result["freed_bytes"] / 1e9,
        " (dry run, nothing deleted)" if args.dry_run else "",
    )
    if result["unmatched"]:
        logger.warning(
            "%d cached models have no launch history and will never be "
            "reclaimed until someone looks at them: %s",
            len(result["unmatched"]),
            ", ".join(result["unmatched"]),
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
