"""Unit tests for the pure memory math (no I/O)."""

from __future__ import annotations

import pytest

from app.services.fit_estimator.constants import GIB
from app.services.fit_estimator.memory_model import (
    Fit,
    effective_kv_heads_per_gpu,
    evaluate_fit,
    heads_shard_evenly,
    kv_heads_replicated,
    kv_pool_required_gib,
    per_token_kv_bytes,
    per_token_kv_bytes_per_gpu,
    token_budget,
    weights_per_gpu_gib,
)


def test_per_token_kv_bytes_hand_computed() -> None:
    # 2 (K+V) x layers(24) x kv_heads(2) x head_dim(64) x dtype_bytes(2)
    assert per_token_kv_bytes(24, 2, 64, 2) == 2 * 24 * 2 * 64 * 2


def test_per_token_kv_gqa_vs_mha_scales_with_kv_heads() -> None:
    gqa = per_token_kv_bytes(24, 2, 64, 2)
    mha = per_token_kv_bytes(24, 14, 64, 2)  # MHA: kv_heads == attn_heads
    assert mha == pytest.approx(7 * gqa)  # 14 / 2 == 7x KV


def test_kv_pool_scales_linearly_with_tokens() -> None:
    per_token = per_token_kv_bytes(4, 1, 64, 2)
    base = kv_pool_required_gib(per_token, 1000)
    assert kv_pool_required_gib(per_token, 2000) == pytest.approx(2 * base)


def test_token_budget_is_len_times_seqs() -> None:
    assert token_budget(4096, 256) == 4096 * 256


def test_evaluate_fit_fits_with_headroom() -> None:
    fit = evaluate_fit(
        weights_gib=10.0,
        kv_pool_required_gib_value=5.0,
        overhead_gib=2.0,
        vram_gib=48.0,
    )
    assert isinstance(fit, Fit)
    assert fit.fits is True
    assert fit.total_gib == pytest.approx(17.0)
    assert fit.headroom_gib == pytest.approx(31.0)


def test_evaluate_fit_does_not_fit() -> None:
    fit = evaluate_fit(
        weights_gib=40.0,
        kv_pool_required_gib_value=10.0,
        overhead_gib=2.0,
        vram_gib=48.0,
    )
    assert fit.fits is False
    assert fit.headroom_gib < 0


def test_kv_pool_gib_uses_binary_gib() -> None:
    assert kv_pool_required_gib(GIB, 1) == pytest.approx(1.0)


# --------------------------------------------------------------------------- #
# Tensor-parallel-aware math.                                                  #
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("tp,expected", [(1, 14.185), (2, 7.0925), (4, 3.546)])
def test_weights_shard_by_tp(tp, expected) -> None:
    weights_bytes = 15_231_233_024  # Qwen2.5-7B
    assert weights_per_gpu_gib(weights_bytes, tp) == pytest.approx(expected, rel=1e-3)


def test_effective_kv_heads_shard_when_divisible() -> None:
    assert effective_kv_heads_per_gpu(4, 1) == 4
    assert effective_kv_heads_per_gpu(4, 2) == 2
    assert effective_kv_heads_per_gpu(4, 4) == 1


def test_effective_kv_heads_floor_at_one_when_replicated() -> None:
    # More ranks than KV heads: replicated, cannot go below one head per rank.
    assert effective_kv_heads_per_gpu(8, 16) == 1.0
    assert effective_kv_heads_per_gpu(4, 8) == 1.0


def test_kv_heads_replicated_predicate() -> None:
    assert kv_heads_replicated(8, 16) is True
    assert kv_heads_replicated(4, 4) is False


def test_heads_shard_evenly_predicate() -> None:
    assert heads_shard_evenly(28, 4, 2) is True
    assert heads_shard_evenly(28, 4, 8) is False  # 28 % 8 != 0


def test_per_token_kv_shards_with_tp() -> None:
    base = per_token_kv_bytes_per_gpu(28, 4, 128, 2, tp_size=1)
    half = per_token_kv_bytes_per_gpu(28, 4, 128, 2, tp_size=2)
    assert base == per_token_kv_bytes(28, 4, 128, 2)  # TP=1 matches single-GPU
    assert half == pytest.approx(base / 2)


def test_per_token_kv_does_not_shrink_past_replication() -> None:
    # kv_heads=4 with tp=8: effective heads floored at 1 (not 0.5).
    tp8 = per_token_kv_bytes_per_gpu(28, 4, 128, 2, tp_size=8)
    tp4 = per_token_kv_bytes_per_gpu(28, 4, 128, 2, tp_size=4)  # 1 head/rank
    assert tp8 == pytest.approx(tp4)
