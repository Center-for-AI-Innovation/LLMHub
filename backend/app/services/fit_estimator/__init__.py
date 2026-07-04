"""Pre-flight GPU fit estimation for vLLM serving jobs on NCSA Delta.

Given a model id + workload, compute whether it fits on each Delta GPU
partition. Ported from the standalone, vLLM-calibrated ``memory-estimator``
repo. vLLM-only; no cost/throughput ranking on this branch (see :mod:`.ranking`).

Public entry points:

* :func:`validate_config` -- pure pre-launch gate: certify a concrete config.
* :func:`validate_config_for_model` -- network-backed config gate by model id.
* :func:`estimate_fit` -- pure: resolved metadata + knobs -> per-partition survey.
* :func:`estimate_fit_for_model` -- network-backed: model id -> per-partition survey.
"""

from __future__ import annotations

from .estimator import (
    AssumptionResult,
    Breakdown,
    FitEstimate,
    PartitionFit,
    estimate_fit,
    estimate_fit_for_model,
)
from .model_metadata import ModelMetadata, fetch_model_metadata, map_config
from .validator import (
    ConfigValidation,
    PerGpuBreakdown,
    validate_config,
    validate_config_for_model,
)

__all__ = [
    "AssumptionResult",
    "Breakdown",
    "FitEstimate",
    "PartitionFit",
    "ModelMetadata",
    "ConfigValidation",
    "PerGpuBreakdown",
    "estimate_fit",
    "estimate_fit_for_model",
    "validate_config",
    "validate_config_for_model",
    "fetch_model_metadata",
    "map_config",
]
