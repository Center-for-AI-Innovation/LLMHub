"""Tests for HF config mapping and weight-size resolution (pure; no network)."""

from __future__ import annotations

from app.services.fit_estimator.model_metadata import (
    WEIGHTS_FROM_CONFIG,
    map_config,
    weights_bytes_from_config,
    weights_bytes_from_header,
    weights_bytes_from_index,
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


def test_map_config_gqa_uses_num_key_value_heads() -> None:
    meta = map_config(GQA_CONFIG, "test/gqa")
    assert meta.n_kv_heads == 4
    assert meta.n_attention_heads == 28
    assert meta.head_dim == 3584 // 28  # 128
    assert meta.kv_fields_known is True
    assert meta.unknown_fields == []


def test_map_config_mha_fallback_when_no_kv_heads() -> None:
    cfg = {k: v for k, v in GQA_CONFIG.items() if k != "num_key_value_heads"}
    meta = map_config(cfg, "test/mha")
    # MHA: kv heads default to attention heads.
    assert meta.n_kv_heads == meta.n_attention_heads == 28


def test_map_config_head_dim_explicit_wins() -> None:
    meta = map_config({**GQA_CONFIG, "head_dim": 256}, "test/head")
    assert meta.head_dim == 256


def test_map_config_missing_fields_reported_not_guessed() -> None:
    meta = map_config({"torch_dtype": "float16"}, "test/sparse")
    assert meta.n_layers is None
    assert meta.head_dim is None
    assert meta.kv_fields_known is False
    for expected in ("num_hidden_layers", "num_attention_heads", "head_dim"):
        assert expected in meta.unknown_fields


def test_map_config_dtype_override() -> None:
    meta = map_config(GQA_CONFIG, "test/dtype", dtype_override="float16")
    assert meta.dtype == "float16"
    assert meta.kv_dtype_bytes == 2.0

    fp8 = map_config(GQA_CONFIG, "test/dtype", dtype_override="fp8")
    assert fp8.kv_dtype_bytes == 1.0


def test_quantization_config_detected() -> None:
    cfg = {**GQA_CONFIG, "quantization_config": {"quant_method": "awq", "bits": 4}}
    meta = map_config(cfg, "test/quant")
    assert meta.quantization == "awq"


def test_weights_bytes_from_config_respects_quant_bits() -> None:
    # 4-bit quantization: param_count x 4 / 8 = half a byte per param.
    cfg = {
        "num_parameters": 8_000_000_000,
        "quantization_config": {"bits": 4},
        "torch_dtype": "bfloat16",
    }
    assert weights_bytes_from_config(cfg, "bfloat16") == 4_000_000_000


def test_weights_bytes_from_config_dtype_when_unquantized() -> None:
    cfg = {"num_parameters": 1_000_000_000, "torch_dtype": "bfloat16"}
    assert weights_bytes_from_config(cfg, "bfloat16") == 2_000_000_000


def test_weights_bytes_from_index_reads_total_size() -> None:
    assert weights_bytes_from_index({"metadata": {"total_size": 123}}) == 123
    assert weights_bytes_from_index({"weight_map": {}}) is None


def test_weights_bytes_from_header_sums_offsets() -> None:
    header = {
        "__metadata__": {"format": "pt"},
        "a": {"dtype": "BF16", "data_offsets": [0, 100]},
        "b": {"dtype": "BF16", "data_offsets": [100, 250]},
    }
    assert weights_bytes_from_header(header) == 250


def test_with_weights_marks_unknown_when_none() -> None:
    meta = map_config(GQA_CONFIG, "test/gqa")
    resolved = with_weights(meta, None, WEIGHTS_FROM_CONFIG)
    assert resolved.weights_bytes is None
    assert resolved.weights_source == "unknown"
    assert "weights_bytes" in resolved.unknown_fields
