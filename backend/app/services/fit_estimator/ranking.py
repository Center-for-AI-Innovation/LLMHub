"""Duration-based SU estimates and partition ordering helpers.

Total job SU is billed per GPU, not per partition:

    job_SU = su_per_gpu_hour × num_gpus × duration_hours

``su_per_gpu_hour`` comes only from the cluster's hardware table, since billing
is site policy; clusters that don't bill leave it out and get no cost figures.
"""

from __future__ import annotations

import re

_SLURM_TIME_RE = re.compile(
    r"^(?:(?P<days>\d+)-)?(?P<hours>\d{1,2}):(?P<minutes>\d{2}):(?P<seconds>\d{2})$"
)


def parse_duration_hours(time_str: str) -> float:
    """Parse SLURM ``D-HH:MM:SS`` or ``HH:MM:SS`` into fractional hours."""
    match = _SLURM_TIME_RE.match(time_str.strip())
    if not match:
        raise ValueError(
            f"Invalid duration {time_str!r}; expected SLURM format HH:MM:SS "
            f"or D-HH:MM:SS"
        )
    days = int(match.group("days") or 0)
    hours = int(match.group("hours"))
    minutes = int(match.group("minutes"))
    seconds = int(match.group("seconds"))
    if minutes >= 60 or seconds >= 60:
        raise ValueError(f"Invalid duration {time_str!r}: minutes/seconds out of range")
    total_seconds = ((days * 24 + hours) * 60 + minutes) * 60 + seconds
    return total_seconds / 3600.0


def effective_su_per_hour(su_per_gpu_hour: int, num_gpus: int) -> int:
    """Aggregate SU/hour for a job using ``num_gpus`` GPUs."""
    if su_per_gpu_hour < 0 or num_gpus < 1:
        raise ValueError("su_per_gpu_hour and num_gpus must be non-negative")
    return su_per_gpu_hour * num_gpus


def estimate_job_su(su_per_gpu_hour: int, num_gpus: int, duration_hours: float) -> int:
    """Total SU = (SU per GPU-hour) × GPU count × walltime hours."""
    if su_per_gpu_hour < 0 or num_gpus < 1 or duration_hours < 0:
        raise ValueError(
            "su_per_gpu_hour, num_gpus, and duration_hours must be non-negative"
        )
    return int(round(effective_su_per_hour(su_per_gpu_hour, num_gpus) * duration_hours))


def partition_job_su_sort_key(
    *,
    feasible: bool | None,
    estimated_job_su: int | None,
    partition: str,
) -> tuple[int, float, str]:
    """Sort key: feasible partitions first (lowest SU), then infeasible."""
    feasible_rank = 0 if feasible else 1
    su = float(estimated_job_su) if estimated_job_su is not None else float("inf")
    return (feasible_rank, su, partition)
