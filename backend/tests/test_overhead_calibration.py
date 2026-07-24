"""Regression tests for the overhead model against real vLLM startup probes.

The overhead model exists to answer one question safely: how much KV-cache room
is left on a GPU after weights + vLLM's own reservations? These tests pin that
against real vLLM 0.11 startups on Delta (A40/A100, TP=1/2/4, max_num_seqs
sweep) so the model cannot silently drift back into optimism.

The model predicts the KV pool as::

    predicted_available_kv = VRAM - overhead - weights_per_gpu

where ``overhead`` folds in the utilization reserve (0.1 * VRAM), the calibrated
``internal(mns) = 0.8 + 0.002 * max_num_seqs``, and the per-rank TP buffer.
Two properties are asserted:

* SAFETY (non-negotiable): predicted <= measured for every run. If we ever
  predict MORE KV room than vLLM actually reports, the gate can false-accept and
  a real job OOMs. This must never regress.
* ACCURACY: predicted is within ~1.2 GiB of measured, i.e. we are conservative but
  not wildly so (otherwise the gate rejects configs that would have run fine).

Raw logs live in ``memory-estimator/calibration/logs/``.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.fit_estimator.constants import (
    DEFAULT_GPU_MEMORY_UTILIZATION,
    OVERHEAD_BASE_GIB,
    OVERHEAD_PER_SEQ_GIB,
)
from app.services.fit_estimator.hardware import load_partitions
from app.services.fit_estimator.overhead import (
    batch_width_overhead_gib,
    internal_overhead_gib,
    total_overhead_per_gpu_gib,
)

_FIXTURE = Path(__file__).parent / "fixtures" / "vllm_calibration_probes.json"
_PROBES = json.loads(_FIXTURE.read_text())["runs"]


def _framework_and_tp_for(gpu_type: str):
    """Pull the calibrated framework/TP-buffer constants from the hardware YAML."""
    for p in load_partitions():
        if p.gpu_type == gpu_type:
            return p.framework_overhead_gib, p.tp_communication_buffer_gib
    raise AssertionError(f"no partition in YAML for gpu_type {gpu_type!r}")


@pytest.mark.parametrize("run", _PROBES, ids=[r["tag"] for r in _PROBES])
def test_overhead_model_is_conservative_and_close(run) -> None:
    framework_gib, tp_buffer_gib = _framework_and_tp_for(run["gpu"])
    mns = int(run["max_num_seqs"])
    overhead = total_overhead_per_gpu_gib(
        run["vram_gib"],
        DEFAULT_GPU_MEMORY_UTILIZATION,
        framework_gib,
        tp_buffer_gib,
        run["tp"],
        mns,
    )
    predicted_kv = run["vram_gib"] - overhead - run["weights_per_gpu_gib"]
    measured_kv = run["available_kv_gib"]

    # SAFETY: never promise more KV than vLLM actually leaves free.
    assert predicted_kv <= measured_kv, (
        f"{run['tag']}: predicted {predicted_kv:.2f} > measured {measured_kv:.2f} "
        f"GiB -- model is OPTIMISTIC, gate could false-accept and OOM."
    )
    # ACCURACY: within ~1.2 GiB (conservative upper-bound line, not wildly so).
    assert measured_kv - predicted_kv <= 1.2, (
        f"{run['tag']}: predicted {predicted_kv:.2f} under measured "
        f"{measured_kv:.2f} by > 1.2 GiB -- over-conservative, tighten calibration."
    )


def test_internal_tracks_max_num_seqs() -> None:
    """Batch-width term must reproduce the calibrated line."""
    assert batch_width_overhead_gib(256) == pytest.approx(0.512)
    assert internal_overhead_gib(32) == pytest.approx(0.8 + 0.002 * 32)
    assert internal_overhead_gib(256) == pytest.approx(0.8 + 0.002 * 256)
    assert internal_overhead_gib(1024) == pytest.approx(0.8 + 0.002 * 1024)
    assert OVERHEAD_BASE_GIB == 0.8
    assert OVERHEAD_PER_SEQ_GIB == 0.002


def test_framework_yaml_matches_calibrated_base() -> None:
    for p in load_partitions():
        if p.is_nvidia:
            assert p.framework_overhead_gib == pytest.approx(OVERHEAD_BASE_GIB)
