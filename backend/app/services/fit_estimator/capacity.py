"""KV-pool capacity model (how vLLM actually behaves at runtime).

vLLM does NOT reserve ``max_model_len × max_num_seqs`` of KV cache. At startup it
allocates a FIXED KV pool from leftover VRAM:

    kv_pool_gib = vram - weights - overhead      (overhead includes the util reserve)

and pages sequences into it (PagedAttention). Beyond the pool it QUEUES / preempts
rather than OOMing. So the meaningful questions are:

* **Will it start?** vLLM needs the pool to hold at least ONE full-length
  sequence (``kv_pool_tokens >= max_model_len``); otherwise it aborts at boot.
* **How much concurrency can it sustain?** derived from the fixed pool, not
  assumed: ``kv_pool_tokens / seq_len``, capped by the ``--max-num-seqs`` scheduler
  limit.

This replaces the fictional ``ctx × 256`` worst-case product for the "will it run"
verdict. All quantities are per-GPU (KV shards across tensor-parallel ranks, and
``per_token_kv_bytes`` is already the per-GPU figure).
"""

from __future__ import annotations

from dataclasses import dataclass

from .constants import GIB


@dataclass(frozen=True)
class KvCapacity:
    """Derived KV-pool capacity for one partition + model + TP configuration."""

    kv_pool_gib: float
    kv_pool_tokens: int
    starts: bool
    concurrent_at_full_context: int
    concurrent_at_typical: int
    typical_seq_len: int
    max_num_seqs_cap: int


def kv_pool_capacity(
    *,
    weights_gib: float,
    overhead_gib: float,
    vram_gib: float,
    per_token_kv_bytes_per_gpu: float,
    max_model_len: int,
    typical_seq_len: int,
    max_num_seqs: int,
) -> KvCapacity | None:
    """Derive the fixed KV pool and the concurrency it can sustain.

    Returns ``None`` if the per-token KV size is unknown (cannot size the pool).
    """
    if per_token_kv_bytes_per_gpu <= 0:
        return None

    kv_pool_gib = vram_gib - weights_gib - overhead_gib
    if kv_pool_gib <= 0:
        return KvCapacity(
            kv_pool_gib=kv_pool_gib,
            kv_pool_tokens=0,
            starts=False,
            concurrent_at_full_context=0,
            concurrent_at_typical=0,
            typical_seq_len=typical_seq_len,
            max_num_seqs_cap=max_num_seqs,
        )

    pool_tokens = int((kv_pool_gib * GIB) / per_token_kv_bytes_per_gpu)
    starts = pool_tokens >= max_model_len

    eff_typical = max(1, min(typical_seq_len, max_model_len))
    conc_full = min(max_num_seqs, pool_tokens // max_model_len)
    conc_typical = min(max_num_seqs, pool_tokens // eff_typical)

    return KvCapacity(
        kv_pool_gib=kv_pool_gib,
        kv_pool_tokens=pool_tokens,
        starts=starts,
        concurrent_at_full_context=conc_full,
        concurrent_at_typical=conc_typical,
        typical_seq_len=eff_typical,
        max_num_seqs_cap=max_num_seqs,
    )
