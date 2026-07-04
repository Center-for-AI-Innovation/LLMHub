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
from dataclasses import dataclass, field
from typing import Any, Mapping

from .constants import DEFAULT_DTYPE, dtype_bytes

HF_ENDPOINT = "https://huggingface.co"
_DEFAULT_TIMEOUT_S = 20.0

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
    unknown_fields: list[str] = field(default_factory=list)

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


def map_config(
    raw: Mapping[str, Any],
    model_id: str,
    *,
    dtype_override: str | None = None,
) -> ModelMetadata:
    """Map a raw HF ``config.json`` dict to :class:`ModelMetadata` (no weights).

    ``weights_bytes`` is left ``None`` here; callers layer it on via
    :func:`with_weights`. Fields that cannot be resolved from the config are
    left ``None`` and recorded in ``unknown_fields``.
    """
    unknown: list[str] = []

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

    dtype = (dtype_override or raw.get("torch_dtype") or DEFAULT_DTYPE)
    dtype = str(dtype)

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
        unknown_fields=unknown,
    )


def weights_bytes_from_index(index: Mapping[str, Any]) -> int | None:
    """``metadata.total_size`` from a safetensors index (sharded models)."""
    meta = index.get("metadata")
    if isinstance(meta, Mapping):
        return _coerce_int(meta.get("total_size"))
    return None


def weights_bytes_from_header(header: Mapping[str, Any]) -> int | None:
    """Sum tensor byte spans from a single-file safetensors header."""
    total = 0
    seen = False
    for name, tensor in header.items():
        if name == "__metadata__" or not isinstance(tensor, Mapping):
            continue
        offsets = tensor.get("data_offsets")
        if isinstance(offsets, (list, tuple)) and len(offsets) == 2:
            begin, end = offsets
            total += int(end) - int(begin)
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
    unknown = list(meta.unknown_fields)
    if weights_bytes is None and "weights_bytes" not in unknown:
        unknown.append("weights_bytes")
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
    resp.raise_for_status()
    return resp.json()


def _fetch_safetensors_header_total(
    client: Any, model_id: str, revision: str
) -> int | None:
    """Read a single-file ``model.safetensors`` header via ranged GETs."""
    url = _resolve_url(model_id, "model.safetensors", revision)
    head = client.get(url, headers={"Range": "bytes=0-7"})
    if head.status_code == 404:
        return None
    head.raise_for_status()
    if len(head.content) < 8:
        return None
    header_len = struct.unpack("<Q", head.content[:8])[0]
    body = client.get(url, headers={"Range": f"bytes=8-{8 + header_len - 1}"})
    body.raise_for_status()
    return weights_bytes_from_header(json.loads(body.content))


def _fetch_weights_bytes(
    client: Any, model_id: str, revision: str
) -> tuple[int | None, str]:
    index_url = _resolve_url(model_id, "model.safetensors.index.json", revision)
    index = _fetch_json(client, index_url)
    if index is not None:
        total = weights_bytes_from_index(index)
        if total is not None:
            return total, WEIGHTS_FROM_INDEX
    header_total = _fetch_safetensors_header_total(client, model_id, revision)
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
    """Fetch config + weight metadata for ``model_id`` (metadata only)."""
    import httpx

    headers = {"Authorization": f"Bearer {token}"} if token else {}
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

    return with_weights(meta, weights_bytes, source)
