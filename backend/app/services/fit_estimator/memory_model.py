"""Pure GPU-memory math for the fit estimator.

Ported from the standalone, vLLM-calibrated ``memory-estimator`` repo. These are
side-effect-free functions over plain numbers so they can be unit tested without
any network, HTTP, or config-file access. Everything is bytes in, GiB out
(1 GiB = 2**30 bytes).

The fit model has three additive terms measured against a partition's VRAM:

    total = weights + kv_pool_required + overhead
    fits  = total <= vram_gib
    headroom_gib = vram_gib - total

``overhead`` is supplied by :mod:`.overhead` (a per-partition framework constant
plus a currently-stubbed activation term). ``kv_pool_required`` is
``per_token_kv_bytes x num_tokens`` where ``num_tokens`` depends on the chosen KV
assumption (see :mod:`.workload`).
"""

from __future__ import annotations

from dataclasses import dataclass

from .constants import GIB


def per_token_kv_bytes(
    n_layers: int,
    n_kv_heads: int,
    head_dim: int,
    kv_dtype_bytes: float,
) -> float:
    """KV-cache bytes for a single token: K and V, summed over all layers.

    ``n_kv_heads`` (not ``n_attention_heads``) is used so grouped-query and
    multi-query attention are sized correctly; callers resolve the MHA fallback
    (``n_kv_heads == n_attention_heads``) upstream.
    """
    return 2 * n_layers * n_kv_heads * head_dim * kv_dtype_bytes


def token_budget(max_model_len: int, max_num_seqs: int) -> int:
    """Worst-case KV token count: one full ``max_model_len`` per concurrent seq."""
    return max_model_len * max_num_seqs


def gib_from_bytes(num_bytes: float) -> float:
    return num_bytes / GIB


def kv_pool_required_gib(per_token_bytes: float, num_tokens: float) -> float:
    """GiB of KV cache needed to hold ``num_tokens`` tokens."""
    return gib_from_bytes(per_token_bytes * num_tokens)


@dataclass(frozen=True)
class Fit:
    """Result of measuring one memory picture against a VRAM budget."""

    fits: bool
    total_gib: float
    headroom_gib: float


def evaluate_fit(
    weights_gib: float,
    kv_pool_required_gib_value: float,
    overhead_gib: float,
    vram_gib: float,
) -> Fit:
    """Add the three terms and compare against ``vram_gib``."""
    total = weights_gib + kv_pool_required_gib_value + overhead_gib
    return Fit(
        fits=total <= vram_gib,
        total_gib=total,
        headroom_gib=vram_gib - total,
    )
