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
    (``n_kv_heads == n_attention_heads``) upstream. This is the single-GPU
    (TP=1) figure; :func:`per_token_kv_bytes_per_gpu` handles tensor parallel.
    """
    return 2 * n_layers * n_kv_heads * head_dim * kv_dtype_bytes


# --------------------------------------------------------------------------- #
# Tensor-parallel-aware math (per-GPU quantities).                             #
#                                                                              #
# Under tensor parallelism a model is split across ``tp_size`` GPUs. Weights   #
# and attention heads shard across ranks; the framework overhead does NOT (see #
# .overhead). These helpers are deliberately conservative -- when sharding is  #
# uneven they round toward MORE per-GPU memory, biasing the gate toward a      #
# false reject rather than a false accept (an OOM at launch).                  #
# --------------------------------------------------------------------------- #


def weights_per_gpu_gib(weights_bytes: float, tp_size: int) -> float:
    """Per-GPU weight footprint under tensor parallelism.

    Approximate: weights divide evenly by ``tp_size``. In reality embedding /
    LM-head sharding and non-divisible head counts cause small per-rank
    imbalance, so a rank can hold slightly more than ``weights / tp_size``.
    Callers should emit a warning on non-divisible head counts (see
    :func:`heads_shard_evenly`); the imbalance is small relative to the
    conservative overhead term.
    """
    return gib_from_bytes(weights_bytes / tp_size)


def effective_kv_heads_per_gpu(n_kv_heads: int, tp_size: int) -> float:
    """KV head groups stored on each rank under tensor parallelism.

    Two regimes, matching vLLM:

    * ``n_kv_heads >= tp_size``: heads shard across ranks -> ``n_kv_heads /
      tp_size`` per rank.
    * ``n_kv_heads < tp_size`` (common for GQA at high TP): there are fewer KV
      heads than ranks, so vLLM REPLICATES KV heads -- every rank holds at least
      one full KV head. KV cache therefore does NOT shrink past one head per
      rank. We floor the effective share at 1.0.

    Using ``max(1.0, n_kv_heads / tp_size)`` (float, not floored) never
    under-counts KV memory, keeping the gate conservative when the division is
    uneven.
    """
    return max(1.0, n_kv_heads / tp_size)


def kv_heads_replicated(n_kv_heads: int, tp_size: int) -> bool:
    """True when there are fewer KV heads than ranks (KV gets replicated)."""
    return n_kv_heads < tp_size


def heads_shard_evenly(n_attention_heads: int, n_kv_heads: int, tp_size: int) -> bool:
    """True when both attention and KV heads divide evenly by ``tp_size``.

    When ``n_kv_heads < tp_size`` the KV-replication path applies instead of
    even sharding; that is reported separately by :func:`kv_heads_replicated`.
    """
    return n_attention_heads % tp_size == 0 and n_kv_heads % tp_size == 0


def per_token_kv_bytes_per_gpu(
    n_layers: int,
    n_kv_heads: int,
    head_dim: int,
    kv_dtype_bytes: float,
    tp_size: int,
) -> float:
    """Per-GPU KV-cache bytes for a single token under tensor parallelism."""
    return (
        2
        * n_layers
        * effective_kv_heads_per_gpu(n_kv_heads, tp_size)
        * head_dim
        * kv_dtype_bytes
    )


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
