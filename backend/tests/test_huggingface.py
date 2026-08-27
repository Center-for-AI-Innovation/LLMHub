"""Tests for Hugging Face model id resolution."""

from __future__ import annotations

from app.utils.huggingface import resolve_hf_model_id


def test_resolve_codellama_catalog_name() -> None:
    assert (
        resolve_hf_model_id(
            "CodeLlama-70b-Instruct-hf",
            family="CodeLlama",
        )
        == "codellama/CodeLlama-70b-Instruct-hf"
    )


def test_resolve_catalog_families_used_by_llmhub() -> None:
    cases = {
        "Aya-Expanse": "CohereLabs/Aya-Expanse-32B",
        "InternVL2_5": "OpenGVLab/InternVL2_5-8B",
        "Meta-Llama-3": "meta-llama/Meta-Llama-3-8B",
        "Molmo": "allenai/Molmo-7B-D",
        "gpt-oss": "openai/gpt-oss-120b",
    }
    for family, expected in cases.items():
        assert resolve_hf_model_id(expected.split("/", 1)[1], family=family) == expected


def test_explicit_huggingface_id_wins() -> None:
    assert (
        resolve_hf_model_id(
            "CodeLlama-70b-Instruct-hf",
            family="CodeLlama",
            huggingface_id="meta-llama/CodeLlama-70b-Instruct-hf",
        )
        == "meta-llama/CodeLlama-70b-Instruct-hf"
    )


def test_slash_model_id_passthrough() -> None:
    assert resolve_hf_model_id("Qwen/Qwen2.5-7B-Instruct") == "Qwen/Qwen2.5-7B-Instruct"
