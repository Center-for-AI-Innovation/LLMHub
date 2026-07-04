"""Regression tests pinning the vLLM-calibrated 0.5B / 7B numbers.

Uses cached HF metadata fixtures (no network). Guards two things the standalone
memory-estimator calibrated against real vLLM startup logs:

* weights within 1% of the calibrated estimate, and
* per-token KV bytes EXACT.

If these drift, the port has diverged from the calibrated math.
"""

from __future__ import annotations

import pytest

from app.services.fit_estimator.estimator import estimate_fit
from app.services.fit_estimator.model_metadata import map_config, with_weights


def _meta_from_fixture(fx):
    base = map_config(fx["config"], fx["model_id"])
    return with_weights(base, fx["weights_bytes"], fx["weights_source"])


@pytest.mark.parametrize("fixture_name", ["qwen_0_5b", "qwen_7b"])
def test_weights_and_kv_match_calibration(fixture_name, request) -> None:
    fx = request.getfixturevalue(fixture_name)
    meta = _meta_from_fixture(fx)
    est = estimate_fit(meta, max_model_len=2048, max_num_seqs=1)

    # Weight bytes are pinned exactly (regression guard on the read path).
    assert meta.weights_bytes == fx["weights_bytes"]

    # Weights within 1% of the calibrated estimate.
    calibrated = fx["estimator_calibrated_weights_gib"]
    assert est.weights_gib == pytest.approx(calibrated, rel=0.01)

    # And within ~1% of the vLLM-reported weights load.
    assert est.weights_gib == pytest.approx(fx["vllm_weights_gib"], rel=0.011)

    # Per-token KV must be EXACT.
    assert est.per_token_kv_bytes == fx["per_token_kv_bytes"]


def test_qwen7b_fits_a40_single_gpu(qwen_7b) -> None:
    # The calibrated worked example: Qwen2.5-7B at seq_len=4096, concurrency=16
    # fits a single A40 (48 GiB).
    meta = _meta_from_fixture(qwen_7b)
    est = estimate_fit(
        meta, max_model_len=4096, max_num_seqs=16, kv_assumption="worst_case"
    )
    a40 = next(p for p in est.partitions if p.partition == "gpuA40x4")
    assert a40.fits is True
    # weights ~14.2 + KV (57344 B/tok x 65536 tok = ~3.5 GiB) + 2 overhead << 48.
    assert a40.breakdown.weights_gib == pytest.approx(14.19, rel=0.01)
    assert a40.breakdown.kv_pool_required_gib == pytest.approx(3.5, rel=0.02)
