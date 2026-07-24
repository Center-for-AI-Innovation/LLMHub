"""Tests for the estimator orchestration (pure; injected metadata)."""

from __future__ import annotations

import pytest

from app.services.fit_estimator.estimator import estimate_fit
from app.services.fit_estimator.hardware import load_partitions
from app.services.fit_estimator.model_metadata import (
    WEIGHTS_FROM_INDEX,
    map_config,
    with_weights,
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


def test_both_assumptions_always_present_and_primary_flagged() -> None:
    est = estimate_fit(
        _meta(),
        max_model_len=4096,
        max_num_seqs=16,
        kv_assumption="typical",
        workload_archetype="chat",
    )
    for p in est.partitions:
        assert set(p.both_assumptions) == {"worst_case", "typical"}
    assert est.kv_assumption == "typical"
    # Primary result mirrors the requested assumption.
    nv = next(p for p in est.partitions if p.supported)
    assert nv.kv_assumption_used == "typical"
    assert nv.fits == nv.both_assumptions["typical"].fits
    assert nv.headroom_gib == pytest.approx(nv.both_assumptions["typical"].headroom_gib)


def test_typical_reserves_fewer_tokens_than_worst_case() -> None:
    est = estimate_fit(
        _meta(), max_model_len=2048, max_num_seqs=256, workload_archetype="chat"
    )
    nv = next(p for p in est.partitions if p.supported)
    worst = nv.both_assumptions["worst_case"]
    typical = nv.both_assumptions["typical"]
    assert typical.tokens < worst.tokens
    assert typical.breakdown.kv_pool_required_gib < worst.breakdown.kv_pool_required_gib


def test_every_delta_partition_is_evaluated() -> None:
    est = estimate_fit(_meta(), max_model_len=4096, max_num_seqs=16)
    expected = {p.partition for p in load_partitions()}
    assert {p.partition for p in est.partitions} == expected


def test_amd_partitions_are_skipped_not_dropped() -> None:
    est = estimate_fit(_meta(), max_model_len=4096, max_num_seqs=16)
    amd = [p for p in est.partitions if p.vendor.upper() == "AMD"]
    assert amd, "expected AMD partitions present in the table"
    for p in amd:
        assert p.supported is False
        assert p.fits is None
        assert p.skipped_reason


def test_h200_fits_where_a40_does_not() -> None:
    # ~56 GiB of worst-case KV (16384 x 64 tokens x 57344 B): exceeds the A40's
    # 48 GiB but fits comfortably on the 141 GiB H200.
    est = estimate_fit(
        _meta(), max_model_len=16384, max_num_seqs=64, kv_assumption="worst_case"
    )
    h200 = next(p for p in est.partitions if p.partition == "gpuH200x8")
    a40 = next(p for p in est.partitions if p.partition == "gpuA40x4")
    assert h200.fits is True
    assert a40.fits is False


def test_unknown_kv_fields_yield_none_fit_with_warning() -> None:
    sparse = with_weights(
        map_config({"torch_dtype": "bfloat16"}, "x/y"), 10, "config_param_count"
    )
    est = estimate_fit(sparse, max_model_len=2048, max_num_seqs=8)
    assert est.per_token_kv_bytes is None
    assert any("KV cache size unknown" in w for w in est.warnings)
    nv = next(p for p in est.partitions if p.supported)
    assert nv.fits is None
    assert nv.both_assumptions["worst_case"].fits is None


def test_defaulted_max_model_len_warns() -> None:
    est = estimate_fit(_meta(), max_num_seqs=16)  # no max_model_len
    assert est.max_model_len == 32768  # from config max_position_embeddings
    assert any("max_model_len defaulted" in w for w in est.warnings)


def test_invalid_kv_assumption_raises() -> None:
    with pytest.raises(ValueError, match="kv_assumption"):
        estimate_fit(_meta(), max_model_len=2048, kv_assumption="average")
