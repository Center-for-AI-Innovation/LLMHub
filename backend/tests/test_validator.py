"""Tests for the pre-launch config validation gate."""

from __future__ import annotations

import pytest

from app.services.fit_estimator.model_metadata import (
    WEIGHTS_FROM_INDEX,
    map_config,
    with_weights,
)
from app.services.fit_estimator.validator import validate_config

QWEN_7B_CONFIG = {
    "num_hidden_layers": 28,
    "hidden_size": 3584,
    "num_attention_heads": 28,
    "num_key_value_heads": 4,
    "max_position_embeddings": 32768,
    "torch_dtype": "bfloat16",
    "vocab_size": 152064,
}
QWEN_7B_WEIGHTS = 15_231_233_024


def _meta(config=QWEN_7B_CONFIG, weights_bytes=QWEN_7B_WEIGHTS, model_id="test/qwen7b"):
    return with_weights(map_config(config, model_id), weights_bytes, WEIGHTS_FROM_INDEX)


def test_7b_valid_single_gpu_a40() -> None:
    # Worst case is 256 concurrent full-context sequences. With the calibrated
    # overhead (~6 GiB on A40: the 0.9 utilization reserve + framework) and
    # ~14.2 GiB weights, the context must be modest to certify on one 44.988 GiB
    # A40: 1024 -> ~14 GiB KV, total ~34 GiB.
    res = validate_config(
        _meta(), max_model_len=1024, tensor_parallel_size=1, partition="gpuA40x4"
    )
    assert res.valid is True
    assert "Config valid" in res.reason
    assert res.per_gpu_breakdown.headroom_gib > 0


@pytest.mark.parametrize("tp", [1, 2, 4])
def test_weights_shard_kv_shards_overhead_constant_per_gpu(tp) -> None:
    res = validate_config(
        _meta(), max_model_len=4096, tensor_parallel_size=tp, partition="gpuH200x8"
    )
    b = res.per_gpu_breakdown
    # Weights divide by TP.
    assert b.weights_gib == pytest.approx(14.185 / tp, rel=1e-3)
    # Overhead is paid in full per GPU and never divided by TP: the utilization
    # reserve (0.1 * 141 GiB on H200) + calibrated internal(mns=256) =
    # 0.8 + 0.002*256, plus the TP comm buffer (0.25) when TP > 1.
    expected_overhead = 141 * 0.1 + 0.8 + 0.002 * 256 + (0.25 if tp > 1 else 0.0)
    assert b.overhead_gib == pytest.approx(expected_overhead)


def test_kv_shards_between_tp1_and_tp2() -> None:
    r1 = validate_config(
        _meta(), max_model_len=4096, tensor_parallel_size=1, partition="gpuH200x8"
    )
    r2 = validate_config(
        _meta(), max_model_len=4096, tensor_parallel_size=2, partition="gpuH200x8"
    )
    assert r2.per_gpu_breakdown.kv_pool_required_gib == pytest.approx(
        r1.per_gpu_breakdown.kv_pool_required_gib / 2
    )


def test_gqa_kv_replication_emits_warning() -> None:
    cfg = {**QWEN_7B_CONFIG, "num_key_value_heads": 8, "num_attention_heads": 32}
    res = validate_config(
        _meta(cfg), max_model_len=2048, tensor_parallel_size=16, partition="gpuH200x8"
    )
    assert any("replicates KV heads" in w for w in res.warnings)


def test_non_divisible_heads_emits_warning() -> None:
    # kv_heads=4, attn_heads=28, tp=3: 4 % 3 != 0 and 28 % 3 != 0, not replicated.
    res = validate_config(
        _meta(), max_model_len=2048, tensor_parallel_size=3, partition="gpuH200x8"
    )
    assert any("not divisible" in w for w in res.warnings)


def test_multi_node_is_explicitly_rejected() -> None:
    res = validate_config(
        _meta(),
        max_model_len=4096,
        tensor_parallel_size=1,
        partition="gpuA40x4",
        num_nodes=2,
    )
    assert res.valid is False
    assert "multi-node validation not yet supported" in res.reason


def test_unresolvable_model_cannot_verify() -> None:
    # Missing weights + KV fields -> never pass by default.
    sparse = with_weights(
        map_config({"torch_dtype": "bfloat16"}, "x/y"), None, "unknown"
    )
    res = validate_config(
        sparse, max_model_len=2048, tensor_parallel_size=1, partition="gpuA40x4"
    )
    assert res.valid is False
    assert "cannot verify" in res.reason


def test_unknown_partition_rejected() -> None:
    res = validate_config(
        _meta(), max_model_len=4096, tensor_parallel_size=1, partition="gpuNope"
    )
    assert res.valid is False
    assert "Unknown partition" in res.reason


def test_amd_partition_rejected() -> None:
    res = validate_config(
        _meta(), max_model_len=4096, tensor_parallel_size=1, partition="gpuMI100x8"
    )
    assert res.valid is False
    assert "non-NVIDIA" in res.reason


def test_70b_fp16_single_a40_rejected_weights_dominated() -> None:
    # ~70B params x 2 bytes = 140 GiB of weights; a single 48 GiB A40 cannot
    # even hold the weights.
    cfg = {
        "num_hidden_layers": 80,
        "hidden_size": 8192,
        "num_attention_heads": 64,
        "num_key_value_heads": 8,
        "max_position_embeddings": 32768,
        "torch_dtype": "float16",
    }
    meta = _meta(cfg, weights_bytes=140_000_000_000, model_id="test/llama-70b")
    res = validate_config(
        meta, max_model_len=4096, tensor_parallel_size=1, partition="gpuA40x4"
    )
    assert res.valid is False
    assert "weights" in res.reason.lower()
    assert "A40" in res.reason


def test_min_sufficient_config_seam_is_null() -> None:
    res = validate_config(
        _meta(), max_model_len=4096, tensor_parallel_size=1, partition="gpuA40x4"
    )
    assert res.min_sufficient_config is None
    assert res.advisory_only is None


def test_tp_makes_large_context_fit_where_tp1_does_not() -> None:
    # 8192 context x 256 worst-case seqs overflows one A40 (~112 GiB KV) but
    # fits at TP=4, where both weights and KV shard across the 4 GPUs.
    r1 = validate_config(
        _meta(), max_model_len=8192, tensor_parallel_size=1, partition="gpuA40x4"
    )
    r4 = validate_config(
        _meta(), max_model_len=8192, tensor_parallel_size=4, partition="gpuA40x4"
    )
    assert r1.valid is False
    assert r4.valid is True
