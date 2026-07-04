"""Shared pytest fixtures for the backend test suite."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

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
