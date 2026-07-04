"""Pre-flight GPU fit estimation for vLLM serving jobs on NCSA Delta.

Given a model id + workload, compute whether it fits on each Delta GPU
partition. Ported from the standalone, vLLM-calibrated ``memory-estimator``
repo. vLLM-only; no cost/throughput ranking on this branch (see :mod:`.ranking`).

Public entry points:

* :func:`estimate_fit` -- pure: resolved metadata + knobs -> per-partition fit.
* :func:`estimate_fit_for_model` -- network-backed: model id -> per-partition fit.
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

__all__ = [
    "AssumptionResult",
    "Breakdown",
    "FitEstimate",
    "PartitionFit",
    "ModelMetadata",
    "estimate_fit",
    "estimate_fit_for_model",
    "fetch_model_metadata",
    "map_config",
]
