"""Resolve catalog model names to Hugging Face repo ids."""

from __future__ import annotations

from typing import Mapping

# Catalog model_family -> Hugging Face org (mirrors frontend launch mapping).
FAMILY_TO_ORG: Mapping[str, str] = {
    "Aya-Expanse": "CohereLabs",
    "BAAI": "BAAI",
    "DeepSeek-AI": "deepseek-ai",
    "InternVL2_5": "OpenGVLab",
    "Qwen": "Qwen",
    "Qwen2": "Qwen",
    "Qwen2.5": "Qwen",
    "Qwen3": "Qwen",
    "QwQ": "Qwen",
    "Llama": "meta-llama",
    "Llama-2": "meta-llama",
    "Llama-3": "meta-llama",
    "Llama-3.1": "meta-llama",
    "Llama-3.2": "meta-llama",
    "Llama-3.3": "meta-llama",
    "Meta-Llama-3": "meta-llama",
    "Meta-Llama-3.1": "meta-llama",
    "Llama-3.1-Nemotron": "nvidia",
    "Mistral": "mistralai",
    "Mixtral": "mistralai",
    "Pixtral": "mistralai",
    "CodeLlama": "codellama",
    "Gemma": "google",
    "Gemma-2": "google",
    "gemma-2": "google",
    "google": "google",
    "Phi": "microsoft",
    "Phi-3": "microsoft",
    "Phi-3-vision": "microsoft",
    "Phi-3.5-vision": "microsoft",
    "Molmo": "allenai",
    "c4ai-command-r": "CohereLabs",
    "deepseek-vl2": "deepseek-ai",
    "e5": "intfloat",
    "glm-4v": "THUDM",
    "gpt-oss": "openai",
    "llava-1.5": "llava-hf",
    "llava-v1.6": "llava-hf",
    "sentence-transformers": "sentence-transformers",
}


def resolve_hf_model_id(
    model_id: str,
    *,
    family: str | None = None,
    huggingface_id: str | None = None,
) -> str:
    """Map a catalog id to a Hugging Face ``org/model`` repo id."""
    if huggingface_id and "/" in huggingface_id:
        return huggingface_id
    if "/" in model_id:
        return model_id

    org = FAMILY_TO_ORG.get(family or "", family or "")
    if not org:
        return model_id
    return f"{org}/{model_id}"
