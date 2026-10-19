"""Tests for HF config mapping and weight-size resolution (pure; no network)."""

from __future__ import annotations

import json
from pathlib import Path

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
    assert meta.unknown_fields == ()


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


# --------------------------------------------------------------------------- #
# Nested VLM configs (real fixtures; the KV cache is sized by the LLM half)    #
# --------------------------------------------------------------------------- #

_FIXTURES = Path(__file__).parent / "fixtures"


def test_internvl_llm_config_resolves() -> None:
    """InternVL2.5 nests complete LLM dims under llm_config (real config)."""
    raw = json.loads((_FIXTURES / "internvl2_5_8b_config.json").read_text())
    meta = map_config(raw, "OpenGVLab/InternVL2_5-8B")
    assert meta.kv_fields_known
    assert meta.n_layers == 32
    assert meta.n_kv_heads == 8
    assert meta.head_dim == 128  # hidden 4096 / heads 32
    assert meta.max_position_embeddings == 32768


def test_mllama_text_config_resolves() -> None:
    """mllama (Llama-3.2-Vision) nests LLM dims under text_config.

    Upstream repo is gated, so this mirrors its structure; the point is that
    nested dims win over the (vision-describing or absent) top level.
    """
    raw = {
        "model_type": "mllama",
        "torch_dtype": "bfloat16",
        "text_config": {
            "num_hidden_layers": 40,
            "num_attention_heads": 32,
            "num_key_value_heads": 8,
            "hidden_size": 4096,
            "max_position_embeddings": 131072,
        },
        "vision_config": {"num_hidden_layers": 32, "hidden_size": 1280},
    }
    meta = map_config(raw, "meta-llama/Llama-3.2-11B-Vision")
    assert meta.kv_fields_known
    assert meta.n_layers == 40  # text stack, not the 32-layer vision tower
    assert meta.n_kv_heads == 8
    assert meta.dtype == "bfloat16"  # top-level dtype survives the merge


def test_llava_sparse_text_config_stays_unresolved() -> None:
    """llava-1.5's text_config omits layer counts (transformers class defaults).

    We refuse to replicate transformers defaults, so this must resolve to
    unknown fields -> an unverifiable verdict (gate skips, never guesses).
    """
    raw = json.loads((_FIXTURES / "llava_1_5_7b_config.json").read_text())
    meta = map_config(raw, "llava-hf/llava-1.5-7b-hf")
    assert not meta.kv_fields_known
    assert "num_hidden_layers" in meta.unknown_fields


def test_malformed_safetensors_span_returns_none() -> None:
    """A negative/garbage span poisons the whole header: under-counting weights
    would make the gate optimistic, so the result must be unknown, not partial."""
    assert weights_bytes_from_header({"t": {"data_offsets": [100, 50]}}) is None
    assert weights_bytes_from_header({"t": {"data_offsets": ["a", "b"]}}) is None
    good = {"t": {"data_offsets": [0, 50]}, "u": {"data_offsets": [50, 80]}}
    assert weights_bytes_from_header(good) == 80


def test_mixed_provenance_dims_never_combine() -> None:
    """Top-level dims on a VLM can describe the vision tower. Combining a
    top-level head count with a text_config hidden_size once halved head_dim —
    a confident 2x KV under-count. Dims must come only from the sub-config."""
    raw = {
        "num_attention_heads": 64,  # vision tower's, not the LLM's
        "text_config": {
            "num_hidden_layers": 32,
            "hidden_size": 4096,
            "num_key_value_heads": 8,
        },
    }
    meta = map_config(raw, "vlm/partial-text-config")
    assert meta.n_attention_heads is None  # top-level 64 must NOT leak in
    assert meta.head_dim is None  # and no 4096/64 mixed-provenance division
    assert not meta.kv_fields_known  # -> unverifiable, the safe outcome


def test_empty_sub_config_does_not_mask_full_one() -> None:
    raw = {
        "text_config": {},
        "llm_config": {
            "num_hidden_layers": 32,
            "num_attention_heads": 32,
            "num_key_value_heads": 8,
            "hidden_size": 4096,
        },
    }
    meta = map_config(raw, "vlm/empty-then-full")
    assert meta.kv_fields_known
    assert meta.n_layers == 32


def test_top_level_dtype_wins_over_sub_config() -> None:
    """vLLM reads the top-level torch_dtype; the merge must match it."""
    raw = {
        "torch_dtype": "bfloat16",
        "text_config": {
            "num_hidden_layers": 32,
            "num_attention_heads": 32,
            "num_key_value_heads": 8,
            "hidden_size": 4096,
            "torch_dtype": "float32",
        },
    }
    meta = map_config(raw, "vlm/dtype-precedence")
    assert meta.dtype == "bfloat16"
    assert meta.kv_dtype_bytes == 2.0


def test_mla_config_flagged() -> None:
    raw = {
        "num_hidden_layers": 61,
        "num_attention_heads": 128,
        "num_key_value_heads": 128,
        "hidden_size": 7168,
        "kv_lora_rank": 512,
    }
    meta = map_config(raw, "deepseek-ai/DeepSeek-V3")
    assert meta.attention_variant == "mla"
    assert map_config(GQA_CONFIG, "x/y").attention_variant is None
