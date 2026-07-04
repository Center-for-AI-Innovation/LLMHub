"""Unit tests for the pure memory math (no I/O)."""

from __future__ import annotations

import pytest

from app.services.fit_estimator.constants import GIB
from app.services.fit_estimator.memory_model import (
    Fit,
    evaluate_fit,
    kv_pool_required_gib,
    per_token_kv_bytes,
    token_budget,
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
    fit = evaluate_fit(weights_gib=10.0, kv_pool_required_gib_value=5.0,
                       overhead_gib=2.0, vram_gib=48.0)
    assert isinstance(fit, Fit)
    assert fit.fits is True
    assert fit.total_gib == pytest.approx(17.0)
    assert fit.headroom_gib == pytest.approx(31.0)


def test_evaluate_fit_does_not_fit() -> None:
    fit = evaluate_fit(weights_gib=40.0, kv_pool_required_gib_value=10.0,
                       overhead_gib=2.0, vram_gib=48.0)
    assert fit.fits is False
    assert fit.headroom_gib < 0


def test_kv_pool_gib_uses_binary_gib() -> None:
    assert kv_pool_required_gib(GIB, 1) == pytest.approx(1.0)
