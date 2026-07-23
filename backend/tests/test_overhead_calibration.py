"""Regression tests for the overhead model against real vLLM startup probes.

The overhead model exists to answer one question safely: how much KV-cache room
is left on a GPU after weights + vLLM's own reservations? These tests pin that
against five real vLLM 0.11 startups on Delta (A40/A100, TP=1/2/4) so the model
cannot silently drift back into optimism.

The model predicts the KV pool as::

    predicted_available_kv = VRAM - overhead - weights_per_gpu

where ``overhead`` folds in the utilization reserve (0.1 * VRAM), the framework
internal constant, and the per-rank TP buffer. Two properties are asserted:

* SAFETY (non-negotiable): predicted <= measured for every run. If we ever
  predict MORE KV room than vLLM actually reports, the gate can false-accept and
  a real job OOMs. This must never regress.
* ACCURACY: predicted is within ~1 GiB of measured, i.e. we are conservative but
  not wildly so (otherwise the gate rejects configs that would have run fine).

Raw logs live in ``memory-estimator/calibration/logs/``.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.fit_estimator.constants import DEFAULT_GPU_MEMORY_UTILIZATION
from app.services.fit_estimator.hardware import load_partitions
from app.services.fit_estimator.overhead import total_overhead_per_gpu_gib

_FIXTURE = Path(__file__).parent / "fixtures" / "vllm_calibration_probes.json"
_PROBES = json.loads(_FIXTURE.read_text())["runs"]

# Empty config: the activation term is stubbed to 0, so it needs no real config.
_NO_CONFIG: dict = {}


def _framework_and_tp_for(gpu_type: str):
    """Pull the calibrated framework/TP-buffer constants from the hardware YAML."""
    for p in load_partitions():
        if p.gpu_type == gpu_type:
            return p.framework_overhead_gib, p.tp_communication_buffer_gib
    raise AssertionError(f"no partition in YAML for gpu_type {gpu_type!r}")


@pytest.mark.parametrize("run", _PROBES, ids=[r["tag"] for r in _PROBES])
def test_overhead_model_is_conservative_and_close(run) -> None:
    framework_gib, tp_buffer_gib = _framework_and_tp_for(run["gpu"])
    overhead = total_overhead_per_gpu_gib(
        run["vram_gib"],
        DEFAULT_GPU_MEMORY_UTILIZATION,
        framework_gib,
        tp_buffer_gib,
        run["tp"],
        _NO_CONFIG,
        0,
    )
    predicted_kv = run["vram_gib"] - overhead - run["weights_per_gpu_gib"]
    measured_kv = run["available_kv_gib"]

    # SAFETY: never promise more KV than vLLM actually leaves free.
    assert predicted_kv <= measured_kv, (
        f"{run['tag']}: predicted {predicted_kv:.2f} > measured {measured_kv:.2f} "
        f"GiB -- model is OPTIMISTIC, gate could false-accept and OOM."
    )
    # ACCURACY: within ~1 GiB (conservative, not wildly so).
    assert measured_kv - predicted_kv <= 1.0, (
        f"{run['tag']}: predicted {predicted_kv:.2f} under measured "
        f"{measured_kv:.2f} by > 1 GiB -- over-conservative, tighten calibration."
    )


def test_internal_overhead_is_vram_independent() -> None:
    """The framework-internal term backed out of each run should cluster ~1 GiB.

    This is the empirical claim that justifies a single constant (rather than a
    per-VRAM value): after removing the VRAM-proportional utilization reserve and
    the TP buffer, the leftover is model-/VRAM-/TP-independent.
    """
    internals = []
    for run in _PROBES:
        reserve = run["vram_gib"] * (1.0 - DEFAULT_GPU_MEMORY_UTILIZATION)
        # implied internal = usable - weights - measured_kv, within the util pool
        usable = run["vram_gib"] - reserve
        internal = usable - run["weights_per_gpu_gib"] - run["available_kv_gib"]
        internals.append(internal)
    # All backed-out internals sit in a tight ~1.0-1.1 GiB band.
    assert min(internals) == pytest.approx(1.05, abs=0.15)
    assert max(internals) == pytest.approx(1.05, abs=0.15)
