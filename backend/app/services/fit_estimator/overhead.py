"""Non-weight, non-KV overhead model (vLLM-calibrated).

    overhead = utilization_reserve + framework_internal + activation + tp_comm

Term 1 (``utilization_reserve``) is ``(1 - gpu_memory_utilization) * VRAM`` -- the
slice of each GPU vLLM refuses to touch. It is the DOMINANT term and scales with
VRAM (see ``DEFAULT_GPU_MEMORY_UTILIZATION``). Folding it into overhead lets the
gate compare against full physical VRAM while remaining exactly equivalent to
"weights + KV + internal <= util * VRAM".

Term 2 (``framework_internal_gib``) is the per-partition constant read from the
hardware YAML (CUDA context, framework allocator, vLLM's profiled reservation).
Calibrated to ~1.0-1.1 GiB and treated as VRAM-/size-/TP-independent; the YAML
carries a conservative 1.5.

Term 3 (``activation_overhead``) is the per-step activation working set. It is a
STUB returning 0.0: the interface and call sites are in place, but the real
coefficient must come from a dedicated probe sweep. Do not invent one here.

Term 4 (``tp_communication_buffer_gib``) is added per rank when ``tp_size > 1``
for NCCL/all-reduce buffers. Measured ~0 at TP<=4; kept small and conservative.

Safety posture: every term over-predicts rather than under-predicts, so the gate
errs toward false-reject (user annoyance) instead of false-accept (launch OOM).
"""

from __future__ import annotations

from typing import Any, Mapping


def activation_overhead_gib(
    model_config: Mapping[str, Any],
    max_batched_tokens: int,
) -> float:
    """Activation working-set overhead in GiB. STUBBED to 0.0.

    TODO(activation-probe): model activation memory as roughly
    ``k x hidden_size x num_hidden_layers x max_batched_tokens x dtype_bytes``
    and fit ``k`` against vLLM startup probes. Until then, returning a made-up
    number would be worse than returning 0 and leaning on the (calibrated)
    utilization reserve + framework constant, so this intentionally returns 0.0.
    """
    _ = (model_config, max_batched_tokens)  # documented interface; unused for now
    return 0.0


def utilization_reserve_gib(vram_gib: float, gpu_memory_utilization: float) -> float:
    """VRAM vLLM reserves and never uses: ``(1 - util) * VRAM``.

    Calibrated as the dominant overhead term: across A40/A100 and TP=1/2/4,
    vLLM's reported "Available KV cache memory" equalled
    ``util*VRAM - weights - framework_internal`` to within ~0.05 GiB.
    """
    return max(0.0, vram_gib * (1.0 - gpu_memory_utilization))


def total_overhead_per_gpu_gib(
    vram_gib: float,
    gpu_memory_utilization: float,
    framework_internal_gib: float,
    tp_communication_buffer_gib: float,
    tp_size: int,
    model_config: Mapping[str, Any],
    max_batched_tokens: int,
) -> float:
    """Per-GPU overhead under tensor parallelism (all four terms).

    The utilization reserve and framework constant are each paid IN FULL by every
    rank -- neither is divided by ``tp_size`` (each GPU has its own VRAM, CUDA
    context, allocator, and workspace). ``tp_communication_buffer_gib`` is added
    per rank only when ``tp_size > 1``. The activation term is stubbed at 0.0.
    """
    overhead = (
        utilization_reserve_gib(vram_gib, gpu_memory_utilization)
        + framework_internal_gib
        + activation_overhead_gib(model_config, max_batched_tokens)
    )
    if tp_size > 1:
        overhead += tp_communication_buffer_gib
    return overhead


def total_overhead_gib(
    vram_gib: float,
    gpu_memory_utilization: float,
    framework_internal_gib: float,
    model_config: Mapping[str, Any],
    max_batched_tokens: int,
) -> float:
    """Single-GPU overhead (survey path): reserve + framework + activation.

    Thin wrapper over :func:`total_overhead_per_gpu_gib` with ``tp_size = 1`` (no
    TP communication buffer).
    """
    return total_overhead_per_gpu_gib(
        vram_gib,
        gpu_memory_utilization,
        framework_internal_gib,
        0.0,
        1,
        model_config,
        max_batched_tokens,
    )
