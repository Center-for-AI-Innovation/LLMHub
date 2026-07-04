"""Delta GPU partition table, loaded from bundled package data.

The YAML ships *inside* the package (``importlib.resources``), never resolved
relative to the repo layout, so the estimator keeps working when installed as a
wheel. Callers may also pass their own parsed partition list (tests, or a future
infrastructure-specific override) without touching the file system.
"""

from __future__ import annotations

import functools
from dataclasses import dataclass
from importlib import resources
from typing import Any

import yaml

from .constants import DEFAULT_FRAMEWORK_OVERHEAD_GIB

_DATA_PACKAGE = "app.services.fit_estimator.data"
_HARDWARE_RESOURCE = "delta_hardware.yaml"

NVIDIA_VENDOR = "NVIDIA"


@dataclass(frozen=True)
class GpuPartition:
    """One Delta GPU partition (single-GPU view)."""

    partition: str
    gpu_type: str
    vendor: str
    vram_gib_per_gpu: float
    framework_overhead_gib: float
    su_per_gpu_hour: int | str | None = None
    max_walltime: str | None = None

    @property
    def is_nvidia(self) -> bool:
        return self.vendor.upper() == NVIDIA_VENDOR


def _parse_entry(raw: dict[str, Any]) -> GpuPartition:
    return GpuPartition(
        partition=str(raw["partition"]),
        gpu_type=str(raw["gpu_type"]),
        vendor=str(raw.get("vendor", NVIDIA_VENDOR)),
        vram_gib_per_gpu=float(raw["vram_gib_per_gpu"]),
        framework_overhead_gib=float(
            raw.get("framework_overhead_gib", DEFAULT_FRAMEWORK_OVERHEAD_GIB)
        ),
        su_per_gpu_hour=raw.get("su_per_gpu_hour"),
        max_walltime=raw.get("max_walltime"),
    )


def parse_partitions(data: Any) -> list[GpuPartition]:
    """Parse an already-loaded YAML/JSON structure into partitions."""
    if isinstance(data, dict):
        entries = data.get("partitions", [])
    else:
        entries = data
    if not isinstance(entries, list):
        raise ValueError("hardware table must be a list of partitions")
    return [_parse_entry(entry) for entry in entries]


@functools.lru_cache(maxsize=1)
def load_partitions() -> tuple[GpuPartition, ...]:
    """Load the bundled Delta partition table (cached)."""
    text = resources.files(_DATA_PACKAGE).joinpath(_HARDWARE_RESOURCE).read_text()
    return tuple(parse_partitions(yaml.safe_load(text)))
