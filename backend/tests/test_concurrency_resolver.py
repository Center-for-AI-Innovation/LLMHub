"""Tests for effective concurrency resolution."""

from __future__ import annotations

from app.services.fit_estimator.concurrency import (
    VLLM_DEFAULT_MAX_NUM_SEQS,
    catalog_max_num_seqs,
    resolve_max_num_seqs,
    vllm_arg_int,
)
from app.services.fit_estimator.constants import LAUNCH_GATE_MAX_NUM_SEQS
from app.services.fit_estimator.estimator import estimate_fit
from app.services.fit_estimator.launch_gate import (
    check_launch_memory_gate,
    resolve_catalog_launch_spec,
)
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
    # vLLM V1-engine default, verified live on the prod container (job 21145772)
    assert VLLM_DEFAULT_MAX_NUM_SEQS == 1024


def test_catalog_max_num_seqs_from_dict_and_string() -> None:
    assert catalog_max_num_seqs({"vllm_args": {"--max-num-seqs": 32}}) == 32
    assert catalog_max_num_seqs({"vllm_args": "--max-num-seqs=64"}) == 64
    assert catalog_max_num_seqs({"vllm_args": {"--max-model-len": 4096}}) is None


def test_typical_llm_defaults_to_vllm_default_not_ui_16() -> None:
    """Regression: catalog omission must not collapse to the old UI factory 16.

    The fallback is the real vLLM default (V1 engine: 1024; measured live on
    the production container), not any UI constant.
    """
    catalog = {"vllm_args": {"--max-model-len": 32768}}
    resolved = resolve_max_num_seqs(catalog_value=catalog_max_num_seqs(catalog))
    assert resolved == VLLM_DEFAULT_MAX_NUM_SEQS == 1024


def test_vision_catalog_preservation_without_ui_override() -> None:
    catalog = {
        "gpus_per_node": 2,
        "vllm_args": {
            "--tensor-parallel-size": 2,
            "--max-model-len": 4096,
            "--max-num-seqs": 32,
        },
    }
    spec = resolve_catalog_launch_spec(
        "Llama-3.2-90B-Vision",
        catalog,
        partition="gpuA40x4",
    )
    assert spec is not None
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


def test_capacity_reports_limited_concurrency_qwen_7b_ctx32k() -> None:
    """Capacity model: Qwen 7B @ 32K starts on A40 but sustains few full-context seqs."""
    meta = _qwen_7b_meta()
    est = estimate_fit(
        meta,
        max_model_len=32768,
        max_num_seqs=256,
        tensor_parallel_size=1,
        typical_seq_len=4096,
    )
    part = next(p for p in est.partitions if p.partition == "gpuA40x4")
    assert part.starts is True
    assert part.kv_pool_tokens is not None and part.kv_pool_tokens >= 32768
    # Full-context concurrency is small; typical (4K) sustains more.
    assert part.concurrent_at_full_context is not None
    assert part.concurrent_at_typical is not None
    assert part.concurrent_at_typical >= part.concurrent_at_full_context


def test_gate_passes_startup_for_qwen_7b_full_context(
    monkeypatch,
) -> None:
    """Capacity model: gate certifies boot; catalog omitting concurrency is fine."""

    def validate_fixture(_model_id, **kwargs):
        assert kwargs["max_num_seqs"] == LAUNCH_GATE_MAX_NUM_SEQS
        return validate_config(_qwen_7b_meta(), **kwargs)

    monkeypatch.setattr(
        "app.services.fit_estimator.launch_gate.validate_config_for_model",
        validate_fixture,
    )
    catalog = {"gpus_per_node": 1, "vllm_args": {"--max-model-len": 32768}}
    gate = check_launch_memory_gate(
        "Qwen2.5-7B-Instruct",
        catalog,
        hf_model="Qwen/Qwen2.5-7B-Instruct",
        partition="gpuA40x4",
    )
    assert gate is not None
    assert gate.valid is True


def test_vllm_arg_int_parses_comma_joined_wire_format() -> None:
    """The launch path joins flags with commas (llm_inference), and only the
    last flag of such a string used to parse — every earlier one silently fell
    back to catalog values, certifying a different context than vLLM booted."""
    s = "--max-model-len=131072,--max-num-seqs=32"
    assert vllm_arg_int(s, "--max-model-len") == 131072
    assert vllm_arg_int(s, "--max-num-seqs") == 32
    reversed_s = "--max-num-seqs=32,--max-model-len=131072"
    assert vllm_arg_int(reversed_s, "--max-model-len") == 131072
    assert vllm_arg_int(reversed_s, "--max-num-seqs") == 32


def test_vllm_arg_int_rejects_garbage_without_crashing() -> None:
    """Bad values must degrade to None (fall through to next precedence),
    never crash (a crash skips the gate) and never coerce bools to 1."""
    assert vllm_arg_int({"--max-model-len": "abc"}, "--max-model-len") is None
    assert vllm_arg_int({"--max-model-len": True}, "--max-model-len") is None
    assert vllm_arg_int({"--max-model-len": None}, "--max-model-len") is None
    assert vllm_arg_int({"--max-model-len": [1]}, "--max-model-len") is None
    assert vllm_arg_int("--max-model-len=abc", "--max-model-len") is None


def test_resolve_max_num_seqs_clamps_non_positive() -> None:
    """mns <= 0 would raise inside the overhead model; a crash must never be
    the cheap way past the gate."""
    assert resolve_max_num_seqs(ui_override=0) == 1
    assert resolve_max_num_seqs(ui_override=-3) == 1
    assert resolve_max_num_seqs(catalog_value=0) == 1
