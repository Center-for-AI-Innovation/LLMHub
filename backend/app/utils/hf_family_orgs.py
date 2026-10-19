"""Fallback resolution of a Hugging Face org from a vec-inf ``model_family``.

``models.yaml`` should normally set ``hf_model`` explicitly per model -- that
is always authoritative. This table only covers models added later without
one: most HF orgs publish an entire model family under a single namespace,
so a new variant of an existing family (e.g. a future ``Qwen3.5-*``) can
resolve its repo id automatically instead of requiring a hand-added
``hf_model`` entry. Derived from (and kept in sync with) the explicit
``hf_model`` values already verified in ``backend/config/models.yaml``.
"""

import re

# Hub repo ids: one "org/name" pair of plain path segments. Anything else (extra
# slashes, "..", URL syntax) must not be spliced into a huggingface.co URL.
_HF_REPO_ID_RE = re.compile(r"^[A-Za-z0-9][\w.-]*/[A-Za-z0-9][\w.-]*$")

FAMILY_TO_HF_ORG: dict[str, str] = {
    "Aya-Expanse": "CohereForAI",
    "BAAI": "BAAI",
    "CodeLlama": "codellama",
    "DeepSeek-AI": "deepseek-ai",
    "InternVL2_5": "OpenGVLab",
    "Llama-2": "meta-llama",
    "Llama-3.1-Nemotron": "nvidia",
    "Llama-3.2": "meta-llama",
    "Llama-3.3": "meta-llama",
    "Meta-Llama-3": "meta-llama",
    "Meta-Llama-3.1": "meta-llama",
    "Mistral": "mistralai",
    "Mixtral": "mistralai",
    "Molmo": "allenai",
    "Phi-3": "microsoft",
    "Phi-3-vision": "microsoft",
    "Phi-3.5-vision": "microsoft",
    "Pixtral": "mistralai",
    "QwQ": "Qwen",
    "Qwen2.5": "Qwen",
    "Qwen3": "Qwen",
    "c4ai-command-r": "CohereForAI",
    "deepseek-vl2": "deepseek-ai",
    "e5": "intfloat",
    "gemma-2": "google",
    "glm-4v": "THUDM",
    "google": "google",
    "gpt-oss": "openai",
    "llava-1.5": "llava-hf",
    "llava-v1.6": "llava-hf",
    "sentence-transformers": "sentence-transformers",
}


def resolve_hf_model(
    model_family: str, model_name: str, explicit_hf_model: str | None
) -> str | None:
    """Return the HF repo id to use for gating/download, or None if unresolvable.

    ``explicit_hf_model`` (an ``hf_model`` set directly in ``models.yaml``)
    always wins. Otherwise, derive ``{org}/{model_name}`` from
    ``FAMILY_TO_HF_ORG`` when the family is known.
    """
    if explicit_hf_model:
        return explicit_hf_model
    org = FAMILY_TO_HF_ORG.get(model_family)
    if not org:
        return None
    return f"{org}/{model_name}"


def resolve_request_hf_model(
    model_id: str,
    model_family: str | None = None,
    huggingface_id: str | None = None,
) -> str | None:
    """Return the HF repo id for an API request naming a model, or None.

    The request may name the model by repo id (``huggingface_id`` or a
    ``model_id`` containing ``/``) or by catalog id plus ``model_family``.
    Returns None when nothing resolves or the repo id is malformed.
    """
    explicit = next((c for c in (huggingface_id, model_id) if c and "/" in c), None)
    repo_id = resolve_hf_model(model_family or "", model_id, explicit)
    if repo_id is None or not _HF_REPO_ID_RE.fullmatch(repo_id):
        return None
    return repo_id
