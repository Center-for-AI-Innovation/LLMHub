"""Tests for the LLMHub launch memory gate."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.services.fit_estimator.constants import (
    DEFAULT_MAX_NUM_SEQS,
    LAUNCH_GATE_MAX_NUM_SEQS,
)
from app.services.fit_estimator.launch_gate import (
    check_launch_memory_gate,
    check_launch_memory_gate_for_model,
    max_gpus_for_partition,
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


def test_resolve_qwen_7b_catalog_spec() -> None:
    catalog = {
        "gpus_per_node": 1,
        "num_nodes": 1,
        "vllm_args": {"--max-model-len": 32768},
    }
    spec = resolve_catalog_launch_spec(
        "Qwen2.5-7B-Instruct",
        catalog,
        hf_model="Qwen/Qwen2.5-7B-Instruct",
        partition="gpuA40x4",
    )
    assert spec is not None
    assert spec.hf_model_id == "Qwen/Qwen2.5-7B-Instruct"
    assert spec.max_model_len == 32768
    assert spec.tensor_parallel_size == 1
    assert spec.num_nodes == 1
    assert spec.partition == "gpuA40x4"


def test_resolve_qwen_32b_uses_tp_from_vllm_args() -> None:
    catalog = {
        "gpus_per_node": 2,
        "num_nodes": 1,
        "vllm_args": {
            "--tensor-parallel-size": 2,
            "--max-model-len": 32768,
        },
    }
    spec = resolve_catalog_launch_spec(
        "Qwen2.5-32B-Instruct",
        catalog,
        partition="gpuA40x4",
    )
    assert spec is not None
    assert spec.tensor_parallel_size == 2


def test_skips_gate_for_unknown_partition() -> None:
    catalog = {"gpus_per_node": 1, "vllm_args": {"--max-model-len": 4096}}
    spec = resolve_catalog_launch_spec(
        "CodeLlama-7b-hf",
        catalog,
        partition="gpuMadeUp",
    )
    assert spec is None


def test_resolve_codellama_catalog_spec() -> None:
    catalog = {
        "model_family": "CodeLlama",
        "gpus_per_node": 4,
        "vllm_args": {"--max-model-len": 4096},
    }
    spec = resolve_catalog_launch_spec(
        "CodeLlama-70b-Instruct-hf",
        catalog,
        partition="gpuA40x4",
    )
    assert spec is not None
    assert spec.hf_model_id == "meta-llama/CodeLlama-70b-Instruct-hf"


def test_gate_certifies_effective_runtime_concurrency() -> None:
    """Catalog Qwen 7B omits --max-num-seqs → effective 256; gate must reject."""
    meta = _qwen_7b_meta()
    launch = validate_config(
        meta,
        max_model_len=32768,
        tensor_parallel_size=1,
        partition="gpuA40x4",
        max_num_seqs=LAUNCH_GATE_MAX_NUM_SEQS,
    )
    effective = validate_config(
        meta,
        max_model_len=32768,
        tensor_parallel_size=1,
        partition="gpuA40x4",
        max_num_seqs=DEFAULT_MAX_NUM_SEQS,
    )
    assert launch.valid is True
    assert effective.valid is False
    gate = check_launch_memory_gate(
        "Qwen2.5-7B-Instruct",
        {"gpus_per_node": 1, "vllm_args": {"--max-model-len": 32768}},
        hf_model="Qwen/Qwen2.5-7B-Instruct",
        partition="gpuA40x4",
    )
    assert gate is not None
    assert gate.valid is effective.valid


def test_check_launch_memory_gate_rejects_when_validator_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    catalog = {
        "gpus_per_node": 1,
        "vllm_args": {"--max-model-len": 32768},
    }
    verdict = type(
        "V",
        (),
        {
            "valid": False,
            "reason": "Config exceeds A40 VRAM",
            "per_gpu_breakdown": None,
            "warnings": [],
        },
    )()
    monkeypatch.setattr(
        "app.services.fit_estimator.launch_gate.validate_config_for_model",
        lambda *a, **k: verdict,
    )
    result = check_launch_memory_gate(
        "Qwen2.5-7B-Instruct",
        catalog,
        hf_model="Qwen/Qwen2.5-7B-Instruct",
        partition="gpuA40x4",
    )
    assert result is not None
    assert result.valid is False


def test_max_gpus_for_partition() -> None:
    assert max_gpus_for_partition("gpuA40x4") == 4
    assert max_gpus_for_partition("gpuA40x4-preempt") == 4
    assert max_gpus_for_partition("gpuA100x8") == 8
    assert max_gpus_for_partition("gpuH200x8-interactive") == 8


def test_launch_gate_rejects_tp_above_partition_capacity() -> None:
    catalog = {
        "gpus_per_node": 8,
        "vllm_args": {"--max-model-len": 4096, "--tensor-parallel-size": 8},
    }
    result = check_launch_memory_gate(
        "Qwen2.5-7B-Instruct",
        catalog,
        hf_model="Qwen/Qwen2.5-7B-Instruct",
        partition="gpuA40x4",
        tensor_parallel_size=8,
    )
    assert result is not None
    assert result.valid is False
    assert "exceeds" in result.reason
    assert "gpuA40x4" in result.reason


def test_check_launch_memory_gate_for_model_load_failure() -> None:
    client = MagicMock(return_value={"success": False, "error": "not found"})
    result = check_launch_memory_gate_for_model("missing-model", client)
    assert result is not None
    assert result.valid is False
    assert "cannot verify" in result.reason
