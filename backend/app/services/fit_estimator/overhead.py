"""Non-weight, non-KV overhead model (vLLM-calibrated).

    overhead = utilization_reserve + framework_base + batch_width + tp_comm

Term 1 (``utilization_reserve``) is ``(1 - gpu_memory_utilization) * VRAM`` -- the
slice of each GPU vLLM refuses to touch. It is the DOMINANT term and scales with
VRAM (see ``DEFAULT_GPU_MEMORY_UTILIZATION``). Folding it into overhead lets the
gate compare against full physical VRAM while remaining exactly equivalent to
"weights + KV + internal <= util * VRAM".

Terms 2+3 are the calibrated per-rank reservation *within* the util pool, ported
from the standalone memory-estimator probes on Delta (vLLM 0.11.0):

    internal(max_num_seqs) = OVERHEAD_BASE_GIB + OVERHEAD_PER_SEQ_GIB * max_num_seqs
                           = 0.8 + 0.002 * max_num_seqs

Measured envelope (7B/A40/TP1 unless noted; inferred GiB):

    max_num_seqs :  32    256    512    1024
    overhead GiB : 0.81  1.07   1.58   2.60

The line is a deliberate conservative UPPER BOUND over every measured point
(0.5B & 7B, A40 & A100, TP1/2/4, mns 32-1024). It is independent of
``max_model_len`` and essentially flat vs model size at fixed ``max_num_seqs``.

Term 4 (``tp_communication_buffer_gib``) is added per rank when ``tp_size > 1``
for NCCL/all-reduce buffers. Measured ~0 at TP<=4; kept small and conservative.

Safety posture: every term over-predicts rather than under-predicts, so the gate
errs toward false-reject (user annoyance) instead of false-accept (launch OOM).
"""

from __future__ import annotations

from .constants import OVERHEAD_BASE_GIB, OVERHEAD_PER_SEQ_GIB


def framework_base_gib(framework_overhead_gib: float | None = None) -> float:
    """CUDA-context / framework floor (GiB), independent of batch width."""
    if framework_overhead_gib is None:
        return OVERHEAD_BASE_GIB
    return max(0.0, float(framework_overhead_gib))


def batch_width_overhead_gib(max_num_seqs: int) -> float:
    """Activation + CUDA-graph capture growth with scheduler batch width.

    Calibrated: ``OVERHEAD_PER_SEQ_GIB * max_num_seqs``. Not a structural
    ``k * hidden * layers`` model -- probes showed the reservation tracks batch
    width, not model size, under the vLLM 0.11.0 envelope we measured.
    """
    if max_num_seqs < 1:
        raise ValueError(f"max_num_seqs must be >= 1, got {max_num_seqs}")
    return OVERHEAD_PER_SEQ_GIB * int(max_num_seqs)


def internal_overhead_gib(
    max_num_seqs: int,
    framework_overhead_gib: float | None = None,
) -> float:
    """Non-weight/non-KV reservation within the util pool (GiB)."""
    return framework_base_gib(framework_overhead_gib) + batch_width_overhead_gib(
        max_num_seqs
    )


def utilization_reserve_gib(vram_gib: float, gpu_memory_utilization: float) -> float:
    """VRAM vLLM reserves and never uses: ``(1 - util) * VRAM``.

    Calibrated as the dominant overhead term: across A40/A100 and TP=1/2/4,
    vLLM's reported "Available KV cache memory" equalled
    ``util*VRAM - weights - internal`` to within ~0.05 GiB at fixed mns.
    """
    return max(0.0, vram_gib * (1.0 - gpu_memory_utilization))


def total_overhead_per_gpu_gib(
    vram_gib: float,
    gpu_memory_utilization: float,
    framework_internal_gib: float,
    tp_communication_buffer_gib: float,
    tp_size: int,
    max_num_seqs: int,
) -> float:
    """Per-GPU overhead under tensor parallelism.

    The utilization reserve and internal(mns) terms are each paid IN FULL by
    every rank -- neither is divided by ``tp_size``. ``tp_communication_buffer_gib``
    is added per rank only when ``tp_size > 1``.
    """
    overhead = utilization_reserve_gib(
        vram_gib, gpu_memory_utilization
    ) + internal_overhead_gib(max_num_seqs, framework_internal_gib)
    if tp_size > 1:
        overhead += tp_communication_buffer_gib
    return overhead


def total_overhead_gib(
    vram_gib: float,
    gpu_memory_utilization: float,
    framework_internal_gib: float,
    max_num_seqs: int,
) -> float:
    """Single-GPU overhead (survey path): reserve + internal(mns).

    Thin wrapper over :func:`total_overhead_per_gpu_gib` with ``tp_size = 1`` (no
    TP communication buffer).
    """
    return total_overhead_per_gpu_gib(
        vram_gib,
        gpu_memory_utilization,
        framework_internal_gib,
        0.0,
        1,
        max_num_seqs,
    )
