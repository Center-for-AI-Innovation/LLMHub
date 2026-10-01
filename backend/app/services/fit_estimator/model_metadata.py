"""Resolve a Hugging Face model id to the metadata the estimator needs.

Two concerns, deliberately separated so the mapping math is testable without a
network:

* Pure mapping (``map_config``, ``weights_bytes_from_*``): plain dict in,
  structured :class:`ModelMetadata` out. No I/O.
* Network fetch (``fetch_model_metadata`` and the ``_fetch_*`` helpers): pull
  ``config.json`` and the safetensors index/header over HTTPS. Metadata only --
  we never download weights (the safetensors header is read with a ranged GET).

Weight bytes are taken, in order of preference:
  1. ``model.safetensors.index.json`` -> ``metadata.total_size`` (sharded models),
  2. the ``model.safetensors`` header (single-file models; ranged read),
  3. ``config.json`` param count x dtype bytes (honoring ``quantization_config``),
  4. otherwise reported as unknown.

Missing config fields are reported in ``unknown_fields`` rather than guessed, so
the estimator can surface "unknown" instead of a fabricated number.
"""

from __future__ import annotations

import json
import struct
import threading
import time
from dataclasses import dataclass
from typing import Any, Mapping

from .constants import DEFAULT_DTYPE, dtype_bytes

HF_ENDPOINT = "https://huggingface.co"
_DEFAULT_TIMEOUT_S = 20.0

# Successful metadata lookups are cached briefly so the launch path does not pay
# 2-4 sequential HF round-trips per request (and an HF blip does not stall every
# launch at once). config.json / safetensors layout for a pinned revision
# changes rarely, so a short TTL loses nothing. Failures are NEVER cached — a
# transient outage must not stick for the TTL. The entry bound exists because
# /api/fit-estimate accepts arbitrary model ids.
_METADATA_CACHE_TTL_S = 600.0
_METADATA_CACHE_MAX_ENTRIES = 256
_metadata_cache: dict[tuple[str, str, str | None], tuple[float, "ModelMetadata"]] = {}
_metadata_cache_lock = threading.Lock()

# Upper bound on a plausible safetensors JSON header. Real headers are tens of
# KiB to a few MiB; anything larger means a corrupt file or a server that
# ignored our Range request, and we refuse to buffer it.
_MAX_SAFETENSORS_HEADER_BYTES = 25_000_000


def clear_metadata_cache() -> None:
    """Drop all cached metadata (tests / operational escape hatch)."""
    with _metadata_cache_lock:
        _metadata_cache.clear()


# Weight-size provenance markers (stable strings; callers/tests may match).
WEIGHTS_FROM_INDEX = "safetensors_index"
WEIGHTS_FROM_HEADER = "safetensors_header"
WEIGHTS_FROM_CONFIG = "config_param_count"
WEIGHTS_UNKNOWN = "unknown"


@dataclass(frozen=True)
class ModelMetadata:
    """Everything the estimator needs about a model, with unknowns flagged."""

    source_model: str
    n_layers: int | None
    n_attention_heads: int | None
    n_kv_heads: int | None
    head_dim: int | None
    hidden_size: int | None
    max_position_embeddings: int | None
    dtype: str
    kv_dtype_bytes: float
    weights_bytes: int | None
    weights_source: str
    quantization: str | None
    # "mla" for Multi-head Latent Attention configs (DeepSeek-V2/V3 family):
    # their KV cache is a compressed latent the 2*L*H*d formula over-counts by
    # an order of magnitude, so the validator refuses to size them.
    attention_variant: str | None = None
    # Tuple, not list: instances are shared via the metadata cache and must be
    # deeply immutable.
    unknown_fields: tuple[str, ...] = ()

    @property
    def kv_fields_known(self) -> bool:
        """True when per-token KV can be computed without guessing."""
        return None not in (self.n_layers, self.n_kv_heads, self.head_dim)


def _coerce_int(value: Any) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def _quantization_label(raw: Mapping[str, Any]) -> str | None:
    qc = raw.get("quantization_config")
    if not isinstance(qc, Mapping):
        return None
    return str(qc.get("quant_method") or qc.get("method") or "quantized")


# Multimodal (VLM) configs nest the language model's dims under a sub-config
# instead of the top level: mllama/gemma3/llava use ``text_config``, InternVL
# uses ``llm_config``, deepseek-vl2 uses ``language_config``. The KV cache is
# sized by the language model, so those dims are the ones we need. First match
# wins; keys the sub-config defines override the top level (a VLM's top-level
# dims, when present alongside a text config, can describe the vision tower).
#
# NOTE this is best-effort, not a guarantee: some VLM configs are sparse (e.g.
# llava-1.5's text_config omits layer counts, relying on transformers class
# defaults we refuse to replicate) — those still resolve to unknown fields and
# an "unverifiable" verdict.
_NESTED_LLM_CONFIG_KEYS = ("text_config", "llm_config", "language_config")

# The architecture dims the KV/weights math reads. When a nested LLM sub-config
# exists, these come ONLY from it: a VLM's top-level dims can describe the
# vision tower, and mixing provenances (top-level heads with text-config
# hidden_size) once produced a halved head_dim — a 2x KV under-count with
# kv_fields_known=True, i.e. a confident wrong answer.
_LLM_DIM_FIELDS = (
    "num_hidden_layers",
    "num_attention_heads",
    "num_key_value_heads",
    "head_dim",
    "hidden_size",
    "max_position_embeddings",
)


def _effective_llm_config(raw: Mapping[str, Any]) -> Mapping[str, Any]:
    """Return ``raw`` with the nested language-model sub-config merged on top.

    First NON-EMPTY sub-config wins (an empty ``text_config`` next to a full
    ``llm_config`` must not mask it). Dim fields are never inherited from the
    top level. ``torch_dtype`` is the one field where the TOP level wins when
    present — it is the value vLLM itself reads.
    """
    for key in _NESTED_LLM_CONFIG_KEYS:
        sub = raw.get(key)
        if isinstance(sub, Mapping) and sub:
            merged = {k: v for k, v in raw.items() if k not in _LLM_DIM_FIELDS}
            merged.update(sub)
            if raw.get("torch_dtype") is not None:
                merged["torch_dtype"] = raw["torch_dtype"]
            return merged
    return raw


def map_config(
    raw: Mapping[str, Any],
    model_id: str,
    *,
    dtype_override: str | None = None,
) -> ModelMetadata:
    """Map a raw HF ``config.json`` dict to :class:`ModelMetadata` (no weights).

    ``weights_bytes`` is left ``None`` here; callers layer it on via
    :func:`with_weights`. Fields that cannot be resolved from the config are
    left ``None`` and recorded in ``unknown_fields``. VLM configs that nest the
    language model's dims (``text_config``/``llm_config``/``language_config``)
    are flattened first — the KV cache is sized by the language model.
    """
    unknown: list[str] = []
    raw = _effective_llm_config(raw)

    n_layers = _coerce_int(raw.get("num_hidden_layers"))
    n_heads = _coerce_int(raw.get("num_attention_heads"))
    hidden = _coerce_int(raw.get("hidden_size"))

    # GQA/MQA: num_key_value_heads; MHA fallback is n_attention_heads.
    n_kv_heads = _coerce_int(raw.get("num_key_value_heads"))
    if n_kv_heads is None and n_heads is not None:
        n_kv_heads = n_heads

    # head_dim: explicit if present, else hidden_size / num_attention_heads.
    head_dim = _coerce_int(raw.get("head_dim"))
    if head_dim is None and hidden is not None and n_heads:
        if hidden % n_heads == 0:
            head_dim = hidden // n_heads

    max_pos = _coerce_int(raw.get("max_position_embeddings"))

    for name, value in (
        ("num_hidden_layers", n_layers),
        ("num_attention_heads", n_heads),
        ("hidden_size", hidden),
        ("num_key_value_heads", n_kv_heads),
        ("head_dim", head_dim),
        ("max_position_embeddings", max_pos),
    ):
        if value is None:
            unknown.append(name)

    dtype = dtype_override or raw.get("torch_dtype") or DEFAULT_DTYPE
    dtype = str(dtype)

    # MLA (DeepSeek-V2/V3 family) compresses KV into a latent; the standard
    # per-token formula over-counts it ~10-25x. Flag it so the validator can
    # refuse to size instead of confidently mis-sizing in either direction.
    attention_variant = (
        "mla" if ("kv_lora_rank" in raw or "q_lora_rank" in raw) else None
    )

    return ModelMetadata(
        source_model=model_id,
        n_layers=n_layers,
        n_attention_heads=n_heads,
        n_kv_heads=n_kv_heads,
        head_dim=head_dim,
        hidden_size=hidden,
        max_position_embeddings=max_pos,
        dtype=dtype,
        kv_dtype_bytes=dtype_bytes(dtype),
        weights_bytes=None,
        weights_source=WEIGHTS_UNKNOWN,
        quantization=_quantization_label(raw),
        attention_variant=attention_variant,
        unknown_fields=tuple(unknown),
    )


def weights_bytes_from_index(index: Mapping[str, Any]) -> int | None:
    """``metadata.total_size`` from a safetensors index (sharded models)."""
    meta = index.get("metadata")
    if isinstance(meta, Mapping):
        return _coerce_int(meta.get("total_size"))
    return None


def weights_bytes_from_header(header: Mapping[str, Any]) -> int | None:
    """Sum tensor byte spans from a single-file safetensors header.

    Any malformed span (non-numeric, negative) makes the whole result ``None``:
    silently skipping entries would under-count weights, and an optimistic
    weights figure turns the launch gate optimistic.
    """
    total = 0
    seen = False
    for name, tensor in header.items():
        if name == "__metadata__" or not isinstance(tensor, Mapping):
            continue
        offsets = tensor.get("data_offsets")
        if isinstance(offsets, (list, tuple)) and len(offsets) == 2:
            begin, end = offsets
            try:
                span = int(end) - int(begin)
            except (TypeError, ValueError):
                return None
            if span < 0:
                return None
            total += span
            seen = True
    return total if seen else None


def _infer_param_count(raw: Mapping[str, Any]) -> int | None:
    """Rough param-count estimate from architecture dims (last-resort only)."""
    hidden = _coerce_int(raw.get("hidden_size"))
    layers = _coerce_int(raw.get("num_hidden_layers"))
    vocab = _coerce_int(raw.get("vocab_size"))
    if hidden is None or layers is None or vocab is None:
        return None
    intermediate = _coerce_int(raw.get("intermediate_size")) or hidden * 4
    return layers * (4 * hidden * hidden + 3 * hidden * intermediate) + vocab * hidden


def weights_bytes_from_config(raw: Mapping[str, Any], dtype: str) -> int | None:
    """param_count x dtype bytes, honoring quantization bit-width when present."""
    param_count = (
        _coerce_int(raw.get("num_parameters"))
        or _coerce_int(raw.get("n_params"))
        or _infer_param_count(raw)
    )
    if param_count is None:
        return None

    qc = raw.get("quantization_config")
    if isinstance(qc, Mapping):
        bits = _coerce_int(qc.get("bits")) or _coerce_int(qc.get("w_bit"))
        if bits:
            return int(param_count * bits / 8)
    return int(param_count * dtype_bytes(dtype))


def with_weights(
    meta: ModelMetadata,
    weights_bytes: int | None,
    weights_source: str,
) -> ModelMetadata:
    """Return a copy of ``meta`` carrying resolved weight bytes/provenance."""
    unknown = meta.unknown_fields
    if weights_bytes is None and "weights_bytes" not in unknown:
        unknown = unknown + ("weights_bytes",)
    return ModelMetadata(
        source_model=meta.source_model,
        n_layers=meta.n_layers,
        n_attention_heads=meta.n_attention_heads,
        n_kv_heads=meta.n_kv_heads,
        head_dim=meta.head_dim,
        hidden_size=meta.hidden_size,
        max_position_embeddings=meta.max_position_embeddings,
        dtype=meta.dtype,
        kv_dtype_bytes=meta.kv_dtype_bytes,
        weights_bytes=weights_bytes,
        weights_source=weights_source if weights_bytes is not None else WEIGHTS_UNKNOWN,
        quantization=meta.quantization,
        attention_variant=meta.attention_variant,
        unknown_fields=unknown,
    )


# --------------------------------------------------------------------------- #
# Network layer (httpx). Imported lazily so the pure math above never pulls in  #
# HTTP machinery, and errors here are easy to isolate from mapping logic.       #
# --------------------------------------------------------------------------- #


def _resolve_url(model_id: str, filename: str, revision: str) -> str:
    return f"{HF_ENDPOINT}/{model_id}/resolve/{revision}/{filename}"


def _fetch_json(client: Any, url: str) -> dict[str, Any] | None:
    resp = client.get(url)
    if resp.status_code == 404:
        return None
    if resp.status_code == 401:
        raise ValueError(
            "Hugging Face returned 401 Unauthorized for "
            f"{url}. Gated models require HF_TOKEN (or HUGGING_FACE_HUB_TOKEN) "
            "in the backend environment."
        )
    if resp.status_code == 403:
        raise ValueError(
            "Hugging Face returned 403 Forbidden for "
            f"{url}. The backend token cannot access this repo — for gated "
            "models the token's account must accept the model license on "
            "huggingface.co first."
        )
    resp.raise_for_status()
    return resp.json()


def _read_stream_prefix(resp: Any, limit: int) -> bytes:
    """Read at most ``limit`` bytes from a streaming response, then stop."""
    buf = bytearray()
    for chunk in resp.iter_bytes():
        buf.extend(chunk)
        if len(buf) >= limit:
            break
    return bytes(buf[:limit])


def _fetch_safetensors_header_total(
    client: Any, model_id: str, revision: str
) -> int | None:
    """Read a single-file ``model.safetensors`` header via ranged GETs.

    Streamed with hard byte limits: a server/proxy that ignores ``Range`` on a
    multi-GB weights file must not be able to buffer that file into backend
    memory. Any anomaly degrades to ``None`` (caller falls back to config-based
    sizing or reports weights unknown — fail-closed downstream).
    """
    url = _resolve_url(model_id, "model.safetensors", revision)
    with client.stream("GET", url, headers={"Range": "bytes=0-7"}) as head:
        if head.status_code == 404:
            return None
        head.raise_for_status()
        prefix = _read_stream_prefix(head, 8)
    if len(prefix) < 8:
        return None
    header_len = struct.unpack("<Q", prefix)[0]
    if not 0 < header_len <= _MAX_SAFETENSORS_HEADER_BYTES:
        return None
    with client.stream(
        "GET", url, headers={"Range": f"bytes=8-{8 + header_len - 1}"}
    ) as body:
        body.raise_for_status()
        payload = _read_stream_prefix(body, header_len)
    if len(payload) < header_len:
        return None
    try:
        header = json.loads(payload)
    except ValueError:
        return None
    if not isinstance(header, Mapping):
        return None
    return weights_bytes_from_header(header)


def _fetch_weights_bytes(
    client: Any, model_id: str, revision: str
) -> tuple[int | None, str]:
    """Weight bytes from safetensors metadata, degrading instead of raising.

    A CDN hiccup (5xx/416/transport error) on the weights files must fall
    through to the config-based estimate — not abort the whole metadata fetch
    (which would turn into an ungated launch via the unverifiable skip). Auth
    errors (our ValueError with an actionable message) still propagate.
    """
    index_url = _resolve_url(model_id, "model.safetensors.index.json", revision)
    try:
        index = _fetch_json(client, index_url)
    except ValueError:
        raise
    except Exception:
        index = None
    if index is not None:
        total = weights_bytes_from_index(index)
        if total is not None:
            return total, WEIGHTS_FROM_INDEX
    try:
        header_total = _fetch_safetensors_header_total(client, model_id, revision)
    except ValueError:
        raise
    except Exception:
        header_total = None
    if header_total is not None:
        return header_total, WEIGHTS_FROM_HEADER
    return None, WEIGHTS_UNKNOWN


def fetch_model_metadata(
    model_id: str,
    *,
    dtype: str | None = None,
    revision: str = "main",
    timeout_s: float = _DEFAULT_TIMEOUT_S,
    token: str | None = None,
) -> ModelMetadata:
    """Fetch config + weight metadata for ``model_id`` (metadata only).

    Successful results are cached for ``_METADATA_CACHE_TTL_S`` keyed on
    ``(model_id, revision, dtype)`` — the explicit ``token`` override is not
    part of the key (production always uses the server-level token).
    """
    import httpx

    from app.config.config import settings

    cache_key = (model_id, revision, dtype)
    now = time.monotonic()
    with _metadata_cache_lock:
        hit = _metadata_cache.get(cache_key)
        if hit is not None and now - hit[0] < _METADATA_CACHE_TTL_S:
            return hit[1]

    resolved_token = token or settings.HF_TOKEN
    headers = {"Authorization": f"Bearer {resolved_token}"} if resolved_token else {}
    with httpx.Client(
        follow_redirects=True, timeout=timeout_s, headers=headers
    ) as client:
        config_url = _resolve_url(model_id, "config.json", revision)
        raw_config = _fetch_json(client, config_url)
        if raw_config is None:
            raise ValueError(f"config.json not found for model {model_id!r}")

        meta = map_config(raw_config, model_id, dtype_override=dtype)

        weights_bytes, source = _fetch_weights_bytes(client, model_id, revision)
        if weights_bytes is None:
            weights_bytes = weights_bytes_from_config(raw_config, meta.dtype)
            source = (
                WEIGHTS_FROM_CONFIG if weights_bytes is not None else WEIGHTS_UNKNOWN
            )

    result = with_weights(meta, weights_bytes, source)
    with _metadata_cache_lock:
        if len(_metadata_cache) >= _METADATA_CACHE_MAX_ENTRIES:
            oldest = min(_metadata_cache, key=lambda k: _metadata_cache[k][0])
            del _metadata_cache[oldest]
        _metadata_cache[cache_key] = (time.monotonic(), result)
    return result
