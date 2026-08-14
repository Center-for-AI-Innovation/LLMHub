"""Tests for the pre-launch config validation gate."""

from __future__ import annotations

import pytest

from app.services.fit_estimator.model_metadata import (
    WEIGHTS_FROM_INDEX,
    map_config,
    with_weights,
)
from app.services.fit_estimator.validator import ConfigValidation, validate_config

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
        _meta(),
        max_model_len=1024,
        tensor_parallel_size=1,
        partition="gpuA40x4",
        max_num_seqs=256,
    )
    assert res.valid is True
    assert "Config valid" in res.reason
    assert res.per_gpu_breakdown.headroom_gib > 0


@pytest.mark.parametrize("tp", [1, 2, 4])
def test_weights_shard_kv_shards_overhead_constant_per_gpu(tp) -> None:
    res = validate_config(
        _meta(),
        max_model_len=4096,
        tensor_parallel_size=tp,
        partition="gpuH200x8",
        max_num_seqs=256,
    )
    b = res.per_gpu_breakdown
    # Weights divide by TP.
    assert b.weights_gib == pytest.approx(14.185 / tp, rel=1e-3)
    # Overhead is paid in full per GPU and never divided by TP: the utilization
    # reserve (0.1 * 140 GiB on H200, padded educated guess) + calibrated
    # internal(mns=256) = 0.8 + 0.002*256, plus the TP comm buffer (0.25) at TP > 1.
    expected_overhead = 140.0 * 0.1 + 0.8 + 0.002 * 256 + (0.25 if tp > 1 else 0.0)
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
    # ~70B params x 2 bytes = 140 GiB of weights; a single 44.988 GiB A40 cannot
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
        _meta(),
        max_model_len=8192,
        tensor_parallel_size=1,
        partition="gpuA40x4",
        max_num_seqs=256,
    )
    r4 = validate_config(
        _meta(),
        max_model_len=8192,
        tensor_parallel_size=4,
        partition="gpuA40x4",
        max_num_seqs=256,
    )
    assert r1.valid is False
    assert r4.valid is True


LLAMA_70B_CONFIG = {
    "num_hidden_layers": 80,
    "hidden_size": 8192,
    "num_attention_heads": 64,
    "num_key_value_heads": 8,
    "head_dim": 128,
    "max_position_embeddings": 131072,
    "torch_dtype": "bfloat16",
    "vocab_size": 128256,
}
LLAMA_70B_WEIGHTS = 141_107_412_992  # safetensors index total_size (~131.4 GiB)


def test_overhead_at_launch_concurrency_closes_boot_false_accept_window() -> None:
    """The gate must charge overhead at the mns the job boots with, not 1.

    Llama-3.3-70B on gpuA100x4 (TP=4): with overhead at mns=1 the certified
    pool holds ~27.4k tokens, but the real job boots at the vLLM default 256
    where the calibrated pool holds only ~20.8k. A context in that window
    (24102 here) used to pass the gate and then die at boot; with
    ``overhead_max_num_seqs`` it must be rejected, while contexts below the
    real boot limit still pass.
    """
    meta = _meta(LLAMA_70B_CONFIG, LLAMA_70B_WEIGHTS, "meta-llama/Llama-3.3-70B")

    legacy_contract = validate_config(
        meta,
        max_model_len=24102,
        tensor_parallel_size=4,
        partition="gpuA100x4",
        max_num_seqs=1,
    )
    assert legacy_contract.valid is True  # documents the old false-accept

    fixed_contract = validate_config(
        meta,
        max_model_len=24102,
        tensor_parallel_size=4,
        partition="gpuA100x4",
        max_num_seqs=1,
        overhead_max_num_seqs=256,
    )
    assert fixed_contract.valid is False

    below_boot_limit = validate_config(
        meta,
        max_model_len=20000,
        tensor_parallel_size=4,
        partition="gpuA100x4",
        max_num_seqs=1,
        overhead_max_num_seqs=256,
    )
    assert below_boot_limit.valid is True


def test_cannot_verify_verdicts_are_marked_unverifiable() -> None:
    """Metadata gaps and non-NVIDIA hardware are unverifiable (gate skips);
    real sizing rejections are not (gate blocks)."""
    sparse = with_weights(
        map_config({"torch_dtype": "bfloat16"}, "sparse/model"),
        None,
        WEIGHTS_FROM_INDEX,
    )
    unresolved = validate_config(
        sparse, max_model_len=4096, tensor_parallel_size=1, partition="gpuA40x4"
    )
    assert unresolved.valid is False
    assert unresolved.unverifiable is True

    amd = validate_config(
        _meta(), max_model_len=4096, tensor_parallel_size=1, partition="gpuMI100x8"
    )
    assert amd.valid is False
    assert amd.unverifiable is True

    too_big = validate_config(
        _meta(LLAMA_70B_CONFIG, LLAMA_70B_WEIGHTS),
        max_model_len=131072,
        tensor_parallel_size=1,
        partition="gpuA40x4",
    )
    assert too_big.valid is False
    assert too_big.unverifiable is False


def test_mla_models_are_unverifiable_not_missized() -> None:
    """DeepSeek-style MLA compresses KV ~10-25x below the standard formula; a
    confident wrong verdict in either direction is worse than a skip."""
    cfg = {**LLAMA_70B_CONFIG, "kv_lora_rank": 512, "q_lora_rank": 1536}
    meta = _meta(cfg, LLAMA_70B_WEIGHTS, "deepseek-ai/DeepSeek-V3")
    res = validate_config(
        meta, max_model_len=4096, tensor_parallel_size=4, partition="gpuA100x4"
    )
    assert res.valid is False
    assert res.unverifiable is True
    assert "MLA" in res.reason


def test_hopper_only_quant_unverifiable_on_ampere_sized_on_h200() -> None:
    """MXFP4/FP8 checkpoints have no native kernels on Ampere: vLLM dequantizes
    at load, so on-disk bytes are not what fills VRAM. Refuse on A40/A100;
    size normally on H200 where the kernels exist."""
    cfg = {
        **QWEN_7B_CONFIG,
        "quantization_config": {"quant_method": "mxfp4"},
    }
    meta = _meta(cfg, QWEN_7B_WEIGHTS, "openai/gpt-oss-120b")
    on_ampere = validate_config(
        meta,
        max_model_len=4096,
        tensor_parallel_size=1,
        partition="gpuA40x4",
        max_num_seqs=1,
        overhead_max_num_seqs=256,
    )
    assert on_ampere.valid is False
    assert on_ampere.unverifiable is True
    on_hopper = validate_config(
        meta,
        max_model_len=4096,
        tensor_parallel_size=1,
        partition="gpuH200x8",
        max_num_seqs=1,
        overhead_max_num_seqs=256,
    )
    assert on_hopper.valid is True  # sized normally where kernels exist

    awq_cfg = {**QWEN_7B_CONFIG, "quantization_config": {"quant_method": "awq"}}
    awq = validate_config(
        _meta(awq_cfg, QWEN_7B_WEIGHTS),
        max_model_len=4096,
        tensor_parallel_size=1,
        partition="gpuA40x4",
        max_num_seqs=1,
        overhead_max_num_seqs=256,
    )
    assert awq.valid is True  # int4 runs natively on Ampere


def test_validate_for_model_resolves_native_context(
    monkeypatch: "pytest.MonkeyPatch",
) -> None:
    """max_model_len=None must validate against the model's native context
    (what vLLM boots with), and refuse when even that is unknown."""
    from app.services.fit_estimator.validator import validate_config_for_model

    meta = _meta()  # native 32768
    monkeypatch.setattr(
        "app.services.fit_estimator.model_metadata.fetch_model_metadata",
        lambda *a, **k: meta,
    )
    res = validate_config_for_model(
        "test/qwen7b",
        max_model_len=None,
        tensor_parallel_size=1,
        partition="gpuA40x4",
        max_num_seqs=1,
        overhead_max_num_seqs=256,
    )
    assert res.valid is True
    assert "32768" in res.reason

    no_native = _meta(
        {k: v for k, v in QWEN_7B_CONFIG.items() if k != "max_position_embeddings"}
    )
    monkeypatch.setattr(
        "app.services.fit_estimator.model_metadata.fetch_model_metadata",
        lambda *a, **k: no_native,
    )
    res = validate_config_for_model(
        "test/qwen7b",
        max_model_len=None,
        tensor_parallel_size=1,
        partition="gpuA40x4",
    )
    assert res.valid is False
    assert res.unverifiable is True


def test_validate_response_roundtrips_unverifiable() -> None:
    """The API schema must expose unverifiable so callers can distinguish
    'will not fit' from 'cannot model it (and the launcher would proceed)'."""
    from app.schemas.validate_config import to_response
    from app.services.fit_estimator.validator import _empty_breakdown

    verdict = ConfigValidation(
        valid=False,
        reason="cannot verify",
        per_gpu_breakdown=_empty_breakdown(),
        unverifiable=True,
    )
    resp = to_response(verdict)
    assert resp.valid is False
    assert resp.unverifiable is True
