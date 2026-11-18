"""Shared pytest fixtures for the backend test suite."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

_FIXTURES_DIR = Path(__file__).parent / "fixtures"


def _load_fixture(name: str) -> dict[str, Any]:
    return json.loads((_FIXTURES_DIR / name).read_text())


@pytest.fixture(scope="session")
def qwen_0_5b() -> dict[str, Any]:
    """Cached Qwen2.5-0.5B-Instruct HF metadata (offline calibration anchor)."""
    return _load_fixture("qwen2_5_0_5b.json")


@pytest.fixture(scope="session")
def qwen_7b() -> dict[str, Any]:
    """Cached Qwen2.5-7B-Instruct HF metadata (offline calibration anchor)."""
    return _load_fixture("qwen2_5_7b.json")


@pytest.fixture(autouse=True)
def _clear_fit_estimator_metadata_cache():
    """Isolate the fit-estimator's TTL metadata cache between tests."""
    from app.services.fit_estimator.model_metadata import clear_metadata_cache

    clear_metadata_cache()
    yield
    clear_metadata_cache()


DELTA_HARDWARE_YAML = ROOT / "config" / "infrastructures" / "delta" / "hardware.yaml"


@pytest.fixture(autouse=True)
def _isolate_hardware_table(monkeypatch):
    """Tests always see Delta's table, whatever infrastructure this machine
    detects and whatever FIT_ESTIMATOR_HARDWARE_YAML the environment sets."""
    from app.services.fit_estimator.hardware import HARDWARE_YAML_ENV, load_partitions

    monkeypatch.delenv(HARDWARE_YAML_ENV, raising=False)
    monkeypatch.setattr(
        "app.config.config.settings.FIT_ESTIMATOR_HARDWARE_YAML",
        str(DELTA_HARDWARE_YAML),
    )
    load_partitions.cache_clear()
    yield
    load_partitions.cache_clear()
