"""GPU hardware table: one per cluster, kept next to its vec-inf config.

The table is ``hardware.yaml`` in the active infrastructure config directory
(:meth:`InfrastructureManager.get_config_path`), the same directory that holds
``environment.yaml``. It therefore follows ``VEC_INF_CONFIG_DIR`` when that is
set (the Delta kit renders one per stack) and the detected infrastructure
otherwise. ``FIT_ESTIMATOR_HARDWARE_YAML`` points at a specific file instead.
A cluster with no table gets an empty one, and the launch gate skips every
launch there.

Rows are keyed by partition, plus the GRES type (``resource_type``) when a
partition mixes GPU types; see :func:`find_partition`. New tables can be
generated from Slurm with ``python -m app.services.fit_estimator.discovery``.
Callers may also pass their own parsed rows (tests) without touching the file
system.
"""

from __future__ import annotations

import functools
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

import yaml

from app.config.logging import get_logger

from .constants import DEFAULT_FRAMEWORK_OVERHEAD_GIB, DEFAULT_TP_COMM_BUFFER_GIB

logger = get_logger("fit_estimator.hardware")

HARDWARE_FILENAME = "hardware.yaml"

# Path to a site-specific hardware YAML (same schema as the bundled table).
HARDWARE_YAML_ENV = "FIT_ESTIMATOR_HARDWARE_YAML"

NVIDIA_VENDOR = "NVIDIA"


@dataclass(frozen=True)
class GpuPartition:
    """One GPU type in one Slurm partition, with per-GPU memory and billing.

    ``resource_type`` is the Slurm GRES type (``gpu:<resource_type>:N``), as a
    launch request sends it; required only to tell apart the rows of a
    partition that mixes GPU types. ``gpus_per_node`` caps tensor parallelism;
    None skips that check. ``compute_capability`` (e.g. 8.0 for A100)
    decides which quantized formats run natively. ``su_per_gpu_hour`` is site
    billing and stays None on clusters that don't bill.
    """

    partition: str
    gpu_type: str
    vendor: str
    vram_gib_per_gpu: float
    framework_overhead_gib: float
    tp_communication_buffer_gib: float = DEFAULT_TP_COMM_BUFFER_GIB
    su_per_gpu_hour: int | None = None
    max_walltime: str | None = None
    resource_type: str | None = None
    compute_capability: float | None = None
    gpus_per_node: int | None = None

    @property
    def is_nvidia(self) -> bool:
        return self.vendor.upper() == NVIDIA_VENDOR


def _parse_entry(raw: dict[str, Any]) -> GpuPartition:
    raw_su_rate = raw.get("su_per_gpu_hour")
    raw_cc = raw.get("compute_capability")
    raw_resource_type = raw.get("resource_type")
    raw_gpus = raw.get("gpus_per_node")
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
        resource_type=str(raw_resource_type) if raw_resource_type else None,
        compute_capability=float(raw_cc) if raw_cc is not None else None,
        gpus_per_node=int(raw_gpus) if raw_gpus is not None else None,
    )


def parse_partitions(data: Any) -> list[GpuPartition]:
    """Parse an already-loaded YAML/JSON structure into partitions."""
    if isinstance(data, dict):
        entries = data.get("partitions", [])
    else:
        entries = data
    if not isinstance(entries, list):
        raise ValueError("hardware table must be a list of partitions")
    rows = [_parse_entry(entry) for entry in entries]
    by_partition: dict[str, list[GpuPartition]] = {}
    for row in rows:
        by_partition.setdefault(row.partition, []).append(row)
    for name, group in by_partition.items():
        if len(group) == 1:
            continue
        keys = [_resource_key(row.resource_type) for row in group]
        if None in keys or len(set(keys)) != len(keys):
            raise ValueError(
                f"hardware table: partition {name!r} has {len(group)} rows; "
                "each needs a distinct resource_type"
            )
    return rows


def _resource_key(resource_type: str | None) -> str | None:
    return resource_type.casefold() if resource_type else None


def find_partition(
    partition: str,
    resource_type: str | None,
    partitions: Sequence[GpuPartition],
) -> tuple[GpuPartition | None, str | None]:
    """Pick the row a launch on ``partition`` with ``resource_type`` lands on.

    Returns ``(row, None)`` or ``(None, reason)``:

    * a row whose ``resource_type`` matches (case-insensitively) wins;
    * otherwise a partition with a single row uses it -- a request naming a
      GRES that partition lacks is rejected by Slurm, not by us;
    * otherwise the partition mixes GPU types and the request doesn't say
      which one, so Slurm may place the job on any of them: no verdict.
    """
    rows = [p for p in partitions if p.partition == partition]
    if not rows:
        return None, f"partition {partition!r} is not in the hardware table"
    wanted = _resource_key(resource_type)
    for row in rows:
        if wanted is not None and _resource_key(row.resource_type) == wanted:
            return row, None
    if len(rows) == 1:
        return rows[0], None
    types = ", ".join(sorted(str(row.resource_type) for row in rows))
    if resource_type:
        return None, (
            f"partition {partition!r} has no GPU type {resource_type!r} in the "
            f"hardware table (known: {types})"
        )
    return None, (
        f"partition {partition!r} mixes GPU types ({types}) and the request "
        "names none"
    )


def hardware_table_path() -> Path:
    """The table this process uses: the override, or the config dir's copy."""
    override = hardware_override_path()
    if override:
        return Path(override)
    from app.utils.infrastructure import InfrastructureManager

    return InfrastructureManager().get_config_path() / HARDWARE_FILENAME


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
    """Load the hardware table (cached; read once at first use).

    A missing table in the config directory means this cluster has none: the
    result is empty and the gate skips every launch. A configured override
    that cannot be read, or any malformed table, raises -- app.main calls this
    at STARTUP so the raise fails the boot loudly instead of being swallowed
    per-launch by the gate's fail-open wrap.
    """
    path = hardware_table_path()
    if not hardware_override_path() and not path.exists():
        logger.warning(
            "No fit-estimator hardware table at %s; the launch memory gate "
            "will skip every launch on this cluster",
            path,
        )
        return ()
    rows = tuple(parse_partitions(yaml.safe_load(path.read_text())))
    logger.info("Fit-estimator hardware table %s: %d rows", path, len(rows))
    return rows
