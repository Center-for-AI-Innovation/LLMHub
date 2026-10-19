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
    resolve_catalog_launch_spec,
)
from app.services.fit_estimator.model_metadata import (
    WEIGHTS_FROM_INDEX,
    map_config,
    with_weights,
)
from app.services.fit_estimator.validator import (
    ConfigValidation,
    _empty_breakdown,
    validate_config,
)

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
        hf_model="Qwen/Qwen2.5-32B-Instruct",
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
    assert spec.hf_model_id == "codellama/CodeLlama-70b-Instruct-hf"


def test_gate_certifies_startup_not_peak_concurrency(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Gate certifies boot (KV pool holds 1 full-context seq), not saturation.

    Qwen 7B @ 32K starts fine on an A40 even though it could not hold 256 full
    concurrent sequences — that is a throughput ceiling, not an OOM, so it must
    NOT block launch.
    """
    meta = _qwen_7b_meta()
    startup = validate_config(
        meta,
        max_model_len=32768,
        tensor_parallel_size=1,
        partition="gpuA40x4",
        max_num_seqs=LAUNCH_GATE_MAX_NUM_SEQS,
    )
    saturated = validate_config(
        meta,
        max_model_len=32768,
        tensor_parallel_size=1,
        partition="gpuA40x4",
        max_num_seqs=DEFAULT_MAX_NUM_SEQS,
    )
    assert startup.valid is True
    assert saturated.valid is False

    def validate_fixture(_model_id, **kwargs):
        # KV budget at the ×1 boot contract, overhead at the resolved launch
        # concurrency (no catalog/user override here -> the vLLM default).
        assert kwargs["max_num_seqs"] == LAUNCH_GATE_MAX_NUM_SEQS
        assert kwargs["overhead_max_num_seqs"] == DEFAULT_MAX_NUM_SEQS
        kwargs.pop("hf_token")
        return validate_config(meta, **kwargs)

    monkeypatch.setattr(
        "app.services.fit_estimator.launch_gate.validate_config_for_model",
        validate_fixture,
    )
    gate = check_launch_memory_gate(
        "Qwen2.5-7B-Instruct",
        {"gpus_per_node": 1, "vllm_args": {"--max-model-len": 32768}},
        hf_model="Qwen/Qwen2.5-7B-Instruct",
        partition="gpuA40x4",
    )
    assert gate is not None
    assert gate.valid is startup.valid is True


def test_check_launch_memory_gate_rejects_when_validator_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A real sizing verdict (not unverifiable) blocks the launch."""
    catalog = {
        "gpus_per_node": 1,
        "vllm_args": {"--max-model-len": 32768},
    }
    verdict = ConfigValidation(
        valid=False,
        reason="Config exceeds A40 VRAM",
        per_gpu_breakdown=_empty_breakdown(),
    )
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


def test_unverifiable_verdict_skips_gate(monkeypatch: pytest.MonkeyPatch) -> None:
    """'Cannot model this' skips the gate instead of blocking curated models.

    Sparse VLM configs (llava-1.5), HF outages, and gated repos produce
    unverifiable verdicts; those launches worked before the gate existed and
    their weights are already local, so the gate must not block them.
    """
    verdict = ConfigValidation(
        valid=False,
        reason="cannot verify 'llava-hf/llava-1.5-7b-hf': unresolved KV config",
        per_gpu_breakdown=_empty_breakdown(),
        unverifiable=True,
    )
    monkeypatch.setattr(
        "app.services.fit_estimator.launch_gate.validate_config_for_model",
        lambda *a, **k: verdict,
    )
    result = check_launch_memory_gate(
        "llava-1.5-7b-hf",
        {"gpus_per_node": 1, "vllm_args": {"--max-model-len": 4096}},
        hf_model="llava-hf/llava-1.5-7b-hf",
        partition="gpuA40x4",
    )
    assert result is None


def test_multi_node_launch_skips_gate(monkeypatch: pytest.MonkeyPatch) -> None:
    """Multi-node catalog entries skip the gate (not modeled), never block."""

    def _must_not_be_called(*_a, **_k):
        raise AssertionError("validator must not run for multi-node launches")

    monkeypatch.setattr(
        "app.services.fit_estimator.launch_gate.validate_config_for_model",
        _must_not_be_called,
    )
    result = check_launch_memory_gate(
        "Llama-3.2-90B-Vision",
        {
            "gpus_per_node": 4,
            "num_nodes": 2,
            "vllm_args": {"--tensor-parallel-size": 8, "--max-model-len": 4096},
        },
        hf_model="meta-llama/Llama-3.2-90B-Vision",
        partition="gpuA40x4",
    )
    assert result is None


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


def test_check_launch_memory_gate_for_model_load_failure_skips() -> None:
    """A broken catalog lookup skips the gate; vec-inf surfaces its own error."""
    client = MagicMock(return_value={"success": False, "error": "not found"})
    result = check_launch_memory_gate_for_model("missing-model", client)
    assert result is None


def test_spec_resolves_launch_concurrency() -> None:
    """spec.max_num_seqs follows explicit param > catalog > the vLLM default."""
    catalog = {
        "model_family": "Llama-3.2",
        "gpus_per_node": 1,
        "vllm_args": {"--max-model-len": 4096, "--max-num-seqs": 64},
    }

    from_catalog = resolve_catalog_launch_spec(
        "Llama-3.2-11B-Vision", catalog, partition="gpuA40x4"
    )
    assert from_catalog is not None
    assert from_catalog.max_num_seqs == 64

    from_param = resolve_catalog_launch_spec(
        "Llama-3.2-11B-Vision", catalog, partition="gpuA40x4", max_num_seqs=32
    )
    assert from_param is not None
    assert from_param.max_num_seqs == 32

    default = resolve_catalog_launch_spec(
        "Qwen2.5-7B-Instruct",
        {
            "model_family": "Qwen2.5",
            "gpus_per_node": 1,
            "vllm_args": {"--max-model-len": 4096},
        },
        partition="gpuA40x4",
    )
    assert default is not None
    assert default.max_num_seqs == DEFAULT_MAX_NUM_SEQS


def test_request_context_overrides_catalog() -> None:
    """llm_inference emits --max-model-len from the request param, which beats
    the catalog's in vec-inf's per-key merge; the gate must see it."""
    spec = resolve_catalog_launch_spec(
        "Qwen2.5-7B-Instruct",
        {
            "model_family": "Qwen2.5",
            "gpus_per_node": 1,
            "vllm_args": {"--max-model-len": 4096},
        },
        partition="gpuA40x4",
        max_model_len=131072,
    )
    assert spec is not None
    assert spec.max_model_len == 131072


def test_spec_context_none_when_unpinned() -> None:
    """No context anywhere -> None: vLLM boots at the model's native context,
    so the validator must size against max_position_embeddings, not a made-up
    default smaller than what actually boots."""
    spec = resolve_catalog_launch_spec(
        "medgemma-4b-it",
        {"model_family": "google", "gpus_per_node": 1},
        partition="gpuA40x4",
    )
    assert spec is not None
    assert spec.max_model_len is None


def test_num_gpus_param_beats_catalog_tp_flag() -> None:
    """llm_inference emits --tensor-parallel-size from num_gpus, overriding the
    catalog flag, so the gate must certify the requested TP."""
    spec = resolve_catalog_launch_spec(
        "Qwen2.5-32B-Instruct",
        {
            "model_family": "Qwen2.5",
            "gpus_per_node": 2,
            "vllm_args": {"--tensor-parallel-size": 2, "--max-model-len": 4096},
        },
        partition="gpuA40x4",
        tensor_parallel_size=4,
    )
    assert spec is not None
    assert spec.tensor_parallel_size == 4


def test_catalog_tp_flag_applies_without_num_gpus() -> None:
    spec = resolve_catalog_launch_spec(
        "Qwen2.5-32B-Instruct",
        {
            "model_family": "Qwen2.5",
            "gpus_per_node": 4,
            "vllm_args": {"--tensor-parallel-size": 2, "--max-model-len": 4096},
        },
        partition="gpuA40x4",
    )
    assert spec is not None
    assert spec.tensor_parallel_size == 2


def test_catalog_hf_model_beats_family_org() -> None:
    spec = resolve_catalog_launch_spec(
        "Aya-Expanse-8B",
        {
            "model_family": "Aya-Expanse",
            "hf_model": "CohereLabs/aya-expanse-8b",
            "gpus_per_node": 1,
            "vllm_args": {"--max-model-len": 4096},
        },
        partition="gpuA40x4",
    )
    assert spec is not None
    assert spec.hf_model_id == "CohereLabs/aya-expanse-8b"


def test_unresolvable_repo_id_skips_gate() -> None:
    spec = resolve_catalog_launch_spec(
        "homegrown-model",
        {"model_family": "NoSuchFamily", "gpus_per_node": 1},
        partition="gpuA40x4",
    )
    assert spec is None


def test_hf_token_reaches_the_validator(monkeypatch: pytest.MonkeyPatch) -> None:
    """Gated repos are sized with the requesting user's own token."""
    seen = {}

    def _validator(*_a, **kwargs):
        seen.update(kwargs)
        return ConfigValidation(True, None, _empty_breakdown())

    monkeypatch.setattr(
        "app.services.fit_estimator.launch_gate.validate_config_for_model",
        _validator,
    )
    check_launch_memory_gate(
        "Llama-3.1-8B-Instruct",
        {"gpus_per_node": 1, "vllm_args": {"--max-model-len": 4096}},
        hf_model="meta-llama/Llama-3.1-8B-Instruct",
        partition="gpuA40x4",
        hf_token="hf_user",
    )
    assert seen["hf_token"] == "hf_user"


def test_unmodeled_memory_flags_skip_gate(monkeypatch: pytest.MonkeyPatch) -> None:
    """Catalog flags that change vLLM's memory picture (util, dtype, lora...)
    make any verdict a guess — the gate must skip loudly, not certify."""

    def _must_not_be_called(*_a, **_k):
        raise AssertionError("validator must not run for unmodeled flags")

    monkeypatch.setattr(
        "app.services.fit_estimator.launch_gate.validate_config_for_model",
        _must_not_be_called,
    )
    result = check_launch_memory_gate(
        "Qwen2.5-7B-Instruct",
        {
            "gpus_per_node": 1,
            "vllm_args": {
                "--max-model-len": 4096,
                "--gpu-memory-utilization": 0.5,
            },
        },
        hf_model="Qwen/Qwen2.5-7B-Instruct",
        partition="gpuA40x4",
    )
    assert result is None


def test_malformed_catalog_values_do_not_crash_resolution() -> None:
    """Garbage catalog values degrade through the precedence chain instead of
    raising (a raise would skip the gate via the model_service wrap)."""
    spec = resolve_catalog_launch_spec(
        "weird-model",
        {
            "hf_model": "org/weird-model",
            "gpus_per_node": "two",
            "max_model_len": "lots",
            "vllm_args": {"--max-model-len": True, "--max-num-seqs": "many"},
        },
        partition="gpuA40x4",
    )
    assert spec is not None
    assert spec.max_model_len is None  # -> native context via the validator
    assert spec.tensor_parallel_size == 1
    assert spec.max_num_seqs == DEFAULT_MAX_NUM_SEQS
