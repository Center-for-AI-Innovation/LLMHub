"""GPU partition table: bundled Delta data or a site-provided override.

The default YAML ships *inside* the package (``importlib.resources``), never
resolved relative to the repo layout, so the estimator keeps working when
installed as a wheel. Other HPC sites point ``FIT_ESTIMATOR_HARDWARE_YAML`` at
a file in the same schema — typically generated from Slurm by
``python -m app.services.fit_estimator.discovery`` (see that module). Callers
may also pass their own parsed partition list (tests) without touching the
file system.
"""

from __future__ import annotations

import functools
import os
from dataclasses import dataclass
from importlib import resources
from pathlib import Path
from typing import Any

import yaml

from .constants import DEFAULT_FRAMEWORK_OVERHEAD_GIB, DEFAULT_TP_COMM_BUFFER_GIB

_DATA_PACKAGE = "app.services.fit_estimator.data"
_HARDWARE_RESOURCE = "delta_hardware.yaml"

# Path to a site-specific hardware YAML (same schema as the bundled table).
HARDWARE_YAML_ENV = "FIT_ESTIMATOR_HARDWARE_YAML"

NVIDIA_VENDOR = "NVIDIA"


@dataclass(frozen=True)
class GpuPartition:
    """One Delta GPU partition with per-GPU memory and billing data."""

    partition: str
    gpu_type: str
    vendor: str
    vram_gib_per_gpu: float
    framework_overhead_gib: float
    tp_communication_buffer_gib: float = DEFAULT_TP_COMM_BUFFER_GIB
    su_per_gpu_hour: int | None = None
    max_walltime: str | None = None

    @property
    def is_nvidia(self) -> bool:
        return self.vendor.upper() == NVIDIA_VENDOR


def _parse_entry(raw: dict[str, Any]) -> GpuPartition:
    raw_su_rate = raw.get("su_per_gpu_hour")
    return GpuPartition(
        partition=str(raw["partition"]),
        gpu_type=str(raw["gpu_type"]),
        vendor=str(raw.get("vendor", NVIDIA_VENDOR)),
        vram_gib_per_gpu=float(raw["vram_gib_per_gpu"]),
        framework_overhead_gib=float(
            raw.get("framework_overhead_gib", DEFAULT_FRAMEWORK_OVERHEAD_GIB)
        ),
        tp_communication_buffer_gib=float(
            raw.get("tp_communication_buffer_gib", DEFAULT_TP_COMM_BUFFER_GIB)
        ),
        su_per_gpu_hour=int(raw_su_rate) if raw_su_rate is not None else None,
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


def hardware_override_path() -> str | None:
    """Site-specific table path from Settings (backend/.env) or the process env."""
    try:
        from app.config.config import settings

        if settings.FIT_ESTIMATOR_HARDWARE_YAML:
            return settings.FIT_ESTIMATOR_HARDWARE_YAML
    except Exception:  # standalone / CLI use without the app config
        pass
    return os.getenv(HARDWARE_YAML_ENV)


@functools.lru_cache(maxsize=1)
def load_partitions() -> tuple[GpuPartition, ...]:
    """Load the partition table (cached; read once at first use).

    ``FIT_ESTIMATOR_HARDWARE_YAML`` selects a site-specific table; otherwise
    the bundled Delta table applies. A configured-but-unreadable override
    raises rather than silently falling back to Delta data on the wrong
    cluster — and app.main calls this at STARTUP so that raise fails the boot
    loudly instead of being swallowed per-launch by the gate's fail-open wrap.
    """
    override = hardware_override_path()
    if override:
        text = Path(override).read_text()
    else:
        text = resources.files(_DATA_PACKAGE).joinpath(_HARDWARE_RESOURCE).read_text()
    return tuple(parse_partitions(yaml.safe_load(text)))
