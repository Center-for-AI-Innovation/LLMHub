"""Tests for the KV-pool capacity model."""

from __future__ import annotations

from app.services.fit_estimator.capacity import kv_pool_capacity
from app.services.fit_estimator.constants import GIB


def _bytes_per_token_for(pool_gib: float, tokens: int) -> float:
    """Per-token KV bytes that make ``pool_gib`` hold exactly ``tokens``."""
    return (pool_gib * GIB) / tokens


def test_returns_none_when_kv_size_unknown() -> None:
    assert (
        kv_pool_capacity(
            weights_gib=10,
            overhead_gib=5,
            vram_gib=45,
            per_token_kv_bytes_per_gpu=0,
            max_model_len=4096,
            typical_seq_len=2048,
            max_num_seqs=256,
        )
        is None
    )


def test_no_pool_when_weights_plus_overhead_exceed_vram() -> None:
    cap = kv_pool_capacity(
        weights_gib=40,
        overhead_gib=10,
        vram_gib=45,
        per_token_kv_bytes_per_gpu=1024,
        max_model_len=4096,
        typical_seq_len=2048,
        max_num_seqs=256,
    )
    assert cap is not None
    assert cap.starts is False
    assert cap.kv_pool_tokens == 0
    assert cap.concurrent_at_full_context == 0


def test_starts_requires_pool_to_hold_one_full_sequence() -> None:
    # Pool holds exactly 1 x max_model_len tokens.
    per_token = _bytes_per_token_for(1.0, 4096)
    cap = kv_pool_capacity(
        weights_gib=20,
        overhead_gib=24,
        vram_gib=45,  # pool = 1 GiB
        per_token_kv_bytes_per_gpu=per_token,
        max_model_len=4096,
        typical_seq_len=1024,
        max_num_seqs=256,
    )
    assert cap is not None
    assert cap.kv_pool_tokens == 4096
    assert cap.starts is True
    assert cap.concurrent_at_full_context == 1
    assert cap.concurrent_at_typical == 4  # 4096 / 1024


def test_does_not_start_when_pool_below_one_full_sequence() -> None:
    per_token = _bytes_per_token_for(1.0, 4096)
    cap = kv_pool_capacity(
        weights_gib=20,
        overhead_gib=24.5,
        vram_gib=45,  # pool = 0.5 GiB -> 2048 tokens < 4096
        per_token_kv_bytes_per_gpu=per_token,
        max_model_len=4096,
        typical_seq_len=1024,
        max_num_seqs=256,
    )
    assert cap is not None
    assert cap.kv_pool_tokens == 2048
    assert cap.starts is False
    assert cap.concurrent_at_full_context == 0
    assert cap.concurrent_at_typical == 2


def test_concurrency_capped_by_max_num_seqs() -> None:
    per_token = _bytes_per_token_for(1.0, 4096)  # 1 GiB -> 4096 tokens
    cap = kv_pool_capacity(
        weights_gib=20,
        overhead_gib=15,
        vram_gib=45,  # pool = 10 GiB
        per_token_kv_bytes_per_gpu=per_token,
        max_model_len=4096,
        typical_seq_len=4096,
        max_num_seqs=4,
    )
    assert cap is not None
    assert cap.starts is True
    # Would be 10 by memory, but scheduler cap is 4.
    assert cap.concurrent_at_full_context == 4
    assert cap.concurrent_at_typical == 4


def test_typical_len_clamped_to_max_model_len() -> None:
    per_token = _bytes_per_token_for(1.0, 4096)  # 1 GiB -> 4096 tokens
    cap = kv_pool_capacity(
        weights_gib=20,
        overhead_gib=21,
        vram_gib=45,  # pool = 4 GiB -> 16384 tokens
        per_token_kv_bytes_per_gpu=per_token,
        max_model_len=4096,
        typical_seq_len=999_999,  # absurd; clamps to max_model_len
        max_num_seqs=256,
    )
    assert cap is not None
    assert cap.typical_seq_len == 4096
    assert cap.concurrent_at_typical == cap.concurrent_at_full_context == 4
