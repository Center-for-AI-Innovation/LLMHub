"""Two-term non-weight, non-KV overhead model.

    overhead = framework_constant_gib + activation_overhead(config, tokens)

Term 1 (``framework_constant_gib``) is a per-partition constant read from the
hardware YAML (CUDA context, framework allocator, vLLM's profiled reservation).
It defaults to 2.0 GiB, deliberately conservative: over-predicting overhead
errs toward recommending a bigger GPU rather than one that OOMs at launch.

Term 2 (``activation_overhead``) is the per-step activation working set, which
grows with hidden_size x layers x the batched-token count. It is a STUB: it
returns 0.0 today so the interface and call sites are in place, but the real
coefficient must come from the pending vLLM probe sweep (see the standalone
memory-estimator calibration notes: backed-out overhead grew 0.75 -> 1.58 GiB
from 0.5B to 7B, which is exactly this activation term). Do not invent a
coefficient here without probe data.
"""

from __future__ import annotations

from typing import Any, Mapping


def activation_overhead_gib(
    model_config: Mapping[str, Any],
    max_batched_tokens: int,
) -> float:
    """Activation working-set overhead in GiB. STUBBED to 0.0.

    TODO(calibration-sweep): model activation memory as roughly
    ``k x hidden_size x num_hidden_layers x max_batched_tokens x dtype_bytes``
    and fit ``k`` against vLLM startup probes across model sizes and
    ``max_num_seqs``. Until we have that data, returning a made-up number would
    be worse than returning 0 and leaning on the conservative framework
    constant, so this intentionally returns 0.0.
    """
    _ = (model_config, max_batched_tokens)  # documented interface; unused for now
    return 0.0


def total_overhead_gib(
    framework_constant_gib: float,
    model_config: Mapping[str, Any],
    max_batched_tokens: int,
) -> float:
    """Sum the framework constant and the (currently 0) activation term."""
    return framework_constant_gib + activation_overhead_gib(
        model_config, max_batched_tokens
    )
