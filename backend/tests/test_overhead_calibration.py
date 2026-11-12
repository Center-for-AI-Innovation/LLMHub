"""Regression tests for each cluster's overhead calibration against real probes.

The overhead model exists to answer one question safely: how much KV-cache room
is left on a GPU after weights + vLLM's own reservations? Each cluster's
hardware table carries values fitted to vLLM startups on that cluster's image
(``tests/fixtures/vllm_probes/<cluster>-v<vllm>.json``, captured with
``backend/scripts/probe_vllm_overhead.py``). The model predicts the KV pool as::

    predicted_available_kv = VRAM - overhead - weights_per_gpu

where ``overhead`` is the utilization reserve plus
``max(floor, base + per_seq * max_num_seqs)`` plus the per-rank TP buffer.
Two properties are asserted for every probe:

* SAFETY (non-negotiable): predicted <= measured. Predicting more KV room than
  vLLM reports would let the check call a config that dies at boot "fits".
* ACCURACY: predicted is within ``_ACCURACY_GIB`` of measured, so warnings are
  not raised for configs that boot comfortably. The bound is loose because one
  line per GPU has to cover vLLM's small-batch bump and, on 0.28, overhead that
  shrinks as TP grows.

``delta-v0.11.0-2026-07.json`` is Ajay's original vLLM 0.11 calibration. It
predates the 2026-08-12 driver update and no longer matches today's nodes, so
it is kept for reference and not tested.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from app.services.fit_estimator.hardware import GpuPartition, parse_partitions
from app.services.fit_estimator.overhead import (
    batch_width_overhead_gib,
    internal_overhead_gib,
    total_overhead_per_gpu_gib,
)

_FIXTURES = Path(__file__).parent / "fixtures" / "vllm_probes"
_INFRA = Path(__file__).resolve().parents[1] / "config" / "infrastructures"
_CALIBRATED = ("delta-v0.19.1.json", "deltaai-v0.28.0.json")
_ACCURACY_GIB = 1.75


def _probes():
    for name in _CALIBRATED:
        fixture = json.loads((_FIXTURES / name).read_text())
        rows = parse_partitions(
            yaml.safe_load(
                (_INFRA / fixture["hardware_table"] / "hardware.yaml").read_text()
            )
        )
        for run in fixture["runs"]:
            yield pytest.param(run, rows, id=run["tag"])


def _row_for(run, rows) -> GpuPartition:
    return next(r for r in rows if r.resource_type == run["resource_type"])


@pytest.mark.parametrize("run, rows", list(_probes()))
def test_table_is_conservative_and_close_to_each_probe(run, rows) -> None:
    gpu = _row_for(run, rows)
    assert gpu.gpu_memory_utilization == pytest.approx(run["gpu_memory_utilization"])
    overhead = total_overhead_per_gpu_gib(
        run["vram_gib"],
        gpu.gpu_memory_utilization,
        gpu.framework_overhead_gib,
        gpu.tp_communication_buffer_gib,
        run["tp"],
        run["max_num_seqs"],
        gpu.overhead_per_seq_gib,
        gpu.overhead_floor_gib,
    )
    predicted_kv = run["vram_gib"] - overhead - run["weights_per_gpu_gib"]
    measured_kv = run["available_kv_gib"]

    assert predicted_kv <= measured_kv, (
        f"{run['tag']}: predicted {predicted_kv:.2f} > measured {measured_kv:.2f} "
        f"GiB -- the table is OPTIMISTIC for this probe."
    )
    assert measured_kv - predicted_kv <= _ACCURACY_GIB, (
        f"{run['tag']}: predicted {predicted_kv:.2f} under measured "
        f"{measured_kv:.2f} by > {_ACCURACY_GIB} GiB -- too conservative."
    )


def test_table_vram_matches_probes() -> None:
    """Measured VRAM must not be below what the table budgets."""
    for pset in _probes():
        run, rows = pset.values
        gpu = _row_for(run, rows)
        assert gpu.vram_gib_per_gpu <= run["vram_gib"] + 0.01, run["tag"]


def test_internal_overhead_takes_the_floor_or_the_line() -> None:
    assert batch_width_overhead_gib(256, 0.002) == pytest.approx(0.512)
    # Small batches: the floor wins (vLLM 0.19.1 uses more at 32 than at 256).
    assert internal_overhead_gib(32, 0.95, 0.002, 1.95) == pytest.approx(1.95)
    # Large batches: the line wins.
    assert internal_overhead_gib(1024, 0.95, 0.002, 1.95) == pytest.approx(
        0.95 + 0.002 * 1024
    )
    # No floor: the old linear model.
    assert internal_overhead_gib(32, 0.8, 0.002) == pytest.approx(0.8 + 0.064)
