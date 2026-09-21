#!/usr/bin/env python3
"""Sync the global model cache with models.yaml. Intended to run from cron."""

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.config.logging import get_logger  # noqa: E402
from app.utils.model_cache import sync_model_cache  # noqa: E402

logger = get_logger("sync_model_cache")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be downloaded and removed without touching disk",
    )
    args = parser.parse_args()

    try:
        result = sync_model_cache(dry_run=args.dry_run)
    except RuntimeError as exc:
        logger.error("Model cache sync failed: %s", exc)
        return 1

    logger.info(
        "Model cache sync complete: %s",
        {key: len(value) for key, value in result.items()},
    )
    if result["failed"]:
        logger.error("Models that failed to download: %s", result["failed"])
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
