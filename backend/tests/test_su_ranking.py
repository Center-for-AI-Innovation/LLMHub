"""Tests for duration-based SU helpers."""

from __future__ import annotations

import pytest

from app.services.fit_estimator.estimator import estimate_fit
from app.services.fit_estimator.model_metadata import (
    WEIGHTS_FROM_INDEX,
    map_config,
    with_weights,
)
from app.services.fit_estimator.ranking import (
    effective_su_per_hour,
    estimate_job_su,
    parse_duration_hours,
    su_per_gpu_hour_for,
)

GQA_CONFIG = {
    "num_hidden_layers": 28,
    "hidden_size": 3584,
    "num_attention_heads": 28,
    "num_key_value_heads": 4,
    "max_position_embeddings": 32768,
    "torch_dtype": "bfloat16",
    "vocab_size": 152064,
}


def _meta(weights_bytes=15_231_233_024):
    base = map_config(GQA_CONFIG, "test/qwen7b")
    return with_weights(base, weights_bytes, WEIGHTS_FROM_INDEX)


def test_parse_duration_hours_hms() -> None:
    assert parse_duration_hours("00:30:00") == pytest.approx(0.5)
    assert parse_duration_hours("01:15:00") == pytest.approx(1.25)


def test_parse_duration_hours_with_days() -> None:
    assert parse_duration_hours("2-00:00:00") == pytest.approx(48.0)


def test_estimate_job_su() -> None:
    # A40: 500 SU/GPU-hr × 2 GPUs × 0.5 hr = 500 SU
    assert estimate_job_su(500, 2, 0.5) == 500
    assert effective_su_per_hour(500, 4) == 2000


def test_fit_estimate_scales_su_with_gpu_count() -> None:
    est1 = estimate_fit(
        _meta(),
        max_model_len=4096,
        max_num_seqs=1,
        tensor_parallel_size=1,
        duration_hours=1.0,
    )
    est4 = estimate_fit(
        _meta(),
        max_model_len=4096,
        max_num_seqs=1,
        tensor_parallel_size=4,
        duration_hours=1.0,
    )
    a40_1 = next(p for p in est1.partitions if p.partition == "gpuA40x4")
    a40_4 = next(p for p in est4.partitions if p.partition == "gpuA40x4")
    assert a40_1.estimated_job_su == 500
    assert a40_1.effective_su_per_hour == 500
    assert a40_4.estimated_job_su == 2000
    assert a40_4.effective_su_per_hour == 2000


def test_su_rate_is_per_gpu_not_partition_node_size() -> None:
    a100_4 = su_per_gpu_hour_for("gpuA100x4", "NVIDIA A100-SXM4-40GB")
    a100_8 = su_per_gpu_hour_for("gpuA100x8", "NVIDIA A100-SXM4-40GB")
    assert a100_4 == 1000
    assert a100_8 == 1000
    # 4 GPUs × 1 hr should cost 4× single GPU, not a flat partition fee.
    assert estimate_job_su(a100_8, 4, 1.0) == 4000
    assert estimate_job_su(a100_4, 1, 1.0) == 1000


def test_preempt_queue_halves_per_gpu_rate() -> None:
    assert su_per_gpu_hour_for("gpuA40x4-preempt", "NVIDIA A40") == 250


def test_fit_estimate_attaches_job_su_and_cheapest() -> None:
    est = estimate_fit(
        _meta(),
        max_model_len=4096,
        max_num_seqs=1,
        tensor_parallel_size=1,
        duration_hours=1.0,
    )
    a40 = next(p for p in est.partitions if p.partition == "gpuA40x4")
    assert a40.estimated_job_su == 500
    assert a40.effective_su_per_hour == 500
    assert est.cheapest_feasible_partition is not None
    assert est.duration_hours == pytest.approx(1.0)

    feasible = [p for p in est.partitions if p.starts is True and p.estimated_job_su]
    if len(feasible) > 1:
        assert feasible[0].estimated_job_su <= feasible[1].estimated_job_su


def test_cheapest_partition_uses_startup_capacity_not_saturation_fit() -> None:
    est = estimate_fit(
        _meta(),
        max_model_len=32768,
        max_num_seqs=256,
        tensor_parallel_size=1,
        duration_hours=0.5,
    )

    a40_preempt = next(p for p in est.partitions if p.partition == "gpuA40x4-preempt")
    assert a40_preempt.starts is True
    assert a40_preempt.fits is False
    assert est.cheapest_feasible_partition == "gpuA40x4-preempt"
