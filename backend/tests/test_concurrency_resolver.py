"""Tests for effective concurrency resolution."""

from __future__ import annotations

from app.services.fit_estimator.concurrency import (
    VLLM_DEFAULT_MAX_NUM_SEQS,
    catalog_max_num_seqs,
    resolve_max_num_seqs,
)
from app.services.fit_estimator.estimator import estimate_fit
from app.services.fit_estimator.launch_gate import check_launch_memory_gate
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
}


def _qwen_7b_meta():
    return with_weights(
        map_config(QWEN_7B_CONFIG, "Qwen/Qwen2.5-7B-Instruct"),
        15_231_233_024,
        WEIGHTS_FROM_INDEX,
    )


def test_resolve_precedence_ui_over_catalog_over_default() -> None:
    assert resolve_max_num_seqs(ui_override=8, catalog_value=32) == 8
    assert resolve_max_num_seqs(catalog_value=32) == 32
    assert resolve_max_num_seqs() == VLLM_DEFAULT_MAX_NUM_SEQS
    assert VLLM_DEFAULT_MAX_NUM_SEQS == 256


def test_catalog_max_num_seqs_from_dict_and_string() -> None:
    assert catalog_max_num_seqs({"vllm_args": {"--max-num-seqs": 32}}) == 32
    assert catalog_max_num_seqs({"vllm_args": "--max-num-seqs=64"}) == 64
    assert catalog_max_num_seqs({"vllm_args": {"--max-model-len": 4096}}) is None


def test_typical_llm_defaults_to_vllm_256_not_ui_16() -> None:
    """Regression: catalog omission must not collapse to the old UI factory 16."""
    catalog = {"vllm_args": {"--max-model-len": 32768}}
    assert resolve_max_num_seqs(catalog_value=catalog_max_num_seqs(catalog)) == 256


def test_vision_catalog_preservation_without_ui_override() -> None:
    catalog = {
        "gpus_per_node": 2,
        "vllm_args": {
            "--tensor-parallel-size": 2,
            "--max-model-len": 4096,
            "--max-num-seqs": 32,
        },
    }
    gate = check_launch_memory_gate(
        "Llama-3.2-90B-Vision",
        catalog,
        partition="gpuA40x4",
    )
    assert gate is not None
    assert resolve_max_num_seqs(catalog_value=catalog_max_num_seqs(catalog)) == 32


def test_ui_override_does_not_use_catalog_when_explicit() -> None:
    catalog = {
        "gpus_per_node": 2,
        "vllm_args": {"--max-num-seqs": 32, "--max-model-len": 4096},
    }
    assert (
        resolve_max_num_seqs(
            ui_override=16,
            catalog_value=catalog_max_num_seqs(catalog),
        )
        == 16
    )


def test_gate_and_estimator_agree_qwen_7b_ctx32k_conc16() -> None:
    """Previously gate (×1) passed while UI (×16) failed — must agree now."""
    meta = _qwen_7b_meta()
    conc = 16
    gate = validate_config(
        meta,
        max_model_len=32768,
        tensor_parallel_size=1,
        partition="gpuA40x4",
        max_num_seqs=conc,
    )
    est = estimate_fit(
        meta,
        max_model_len=32768,
        max_num_seqs=conc,
        tensor_parallel_size=1,
        kv_assumption="worst_case",
    )
    part = next(p for p in est.partitions if p.partition == "gpuA40x4")
    assert gate.valid is False
    assert part.fits is False


def test_gate_rejects_catalog_default_256_for_qwen_7b_full_context() -> None:
    """Option A: certify effective runtime concurrency (256), not boot-only ×1."""
    catalog = {"gpus_per_node": 1, "vllm_args": {"--max-model-len": 32768}}
    gate = check_launch_memory_gate(
        "Qwen2.5-7B-Instruct",
        catalog,
        hf_model="Qwen/Qwen2.5-7B-Instruct",
        partition="gpuA40x4",
    )
    assert gate is not None
    assert gate.valid is False
