"""Tunable defaults for the GPU fit estimator.

Kept in one place so LLMFlux (or a future calibration sweep) can pin different
values without hunting through the estimator internals. Nothing here is a
calibration *result*; those live in the hardware / archetype YAML data files.
"""

from __future__ import annotations

# 1 GiB = 2**30 bytes. Every ``*_gib`` field in this package is binary GiB.
GIB = 2**30

# vLLM's default maximum number of concurrent sequences (``--max-num-seqs``).
# LLMFlux may launch with a different cap; override via the request or by
# changing this constant.
DEFAULT_MAX_NUM_SEQS = 256

# LLMHub launch gate historically certified startup with one sequence; gate now
# uses resolve_max_num_seqs() (effective launch concurrency). Kept for tests/docs.
LAUNCH_GATE_MAX_NUM_SEQS = 1

# Bytes per element for the dtypes we care about when sizing weights / KV.
# Quantized weight formats are handled separately (see model_metadata), because
# their on-disk size is read directly from the safetensors metadata.
DTYPE_BYTES: dict[str, float] = {
    "float32": 4.0,
    "float": 4.0,
    "fp32": 4.0,
    "float16": 2.0,
    "fp16": 2.0,
    "half": 2.0,
    "bfloat16": 2.0,
    "bf16": 2.0,
    "float8": 1.0,
    "fp8": 1.0,
    "fp8_e4m3": 1.0,
    "fp8_e5m2": 1.0,
    "int8": 1.0,
    "int4": 0.5,
    "uint4": 0.5,
}

# Default activation/compute dtype when a model config omits ``torch_dtype``.
DEFAULT_DTYPE = "bfloat16"

# vLLM's ``--gpu-memory-utilization``: the fraction of each GPU's VRAM vLLM is
# allowed to manage. The remaining ``(1 - util) * VRAM`` is reserved and never
# used, so it is the DOMINANT overhead term (e.g. ~4.5 GiB on a 48 GiB A40, and
# ~14 GiB on a 141 GiB H200). LLMFlux launches every model at 0.9 (see its
# models.yaml), which is also vLLM's own default. Calibrated: vLLM's reported
# "Available KV cache memory" matched ``util*VRAM - weights - framework_internal``
# within ~0.05 GiB across A40/A100 and TP=1/2/4 (see calibration/ probe logs).
DEFAULT_GPU_MEMORY_UTILIZATION = 0.9

# Per-GPU framework "internal" overhead (GiB): CUDA context, the framework
# allocator, and vLLM's profiled non-weight/non-KV working set. This is what is
# left AFTER accounting for the utilization reserve above. Fallback used only if
# a partition entry omits ``framework_overhead_gib``.
# Calibrated: backed out at ~1.02-1.11 GiB and effectively CONSTANT across model
# size (0.5B/7B), VRAM (A40 48 GiB / A100 40 GiB), and TP (1/2/4). Rounded up to
# 1.5 to stay conservative (bias toward false-reject).
DEFAULT_FRAMEWORK_OVERHEAD_GIB = 1.5

# Per-GPU extra reservation for tensor-parallel communication buffers (NCCL
# buffers, all-reduce workspace). Applied per rank only when tp_size > 1.
# Calibrated: the backed-out per-GPU overhead did NOT grow measurably with TP
# (internal term 1.07/1.11/1.08 GiB at TP=1/2/4 on A40 -- noise level, no trend),
# so the real TP buffer is ~0 at TP<=4. Kept at a small conservative 0.25 GiB as
# a safety margin for higher TP (8/16), which has not been probed yet.
# TODO(high-tp-probe): measure at TP=8/16 before trusting large-TP verdicts.
DEFAULT_TP_COMM_BUFFER_GIB = 0.25

# The two KV-cache sizing assumptions we always compute. ``worst_case`` reserves
# the full token budget; ``typical`` scales it by a workload archetype factor.
KV_ASSUMPTION_WORST_CASE = "worst_case"
KV_ASSUMPTION_TYPICAL = "typical"
KV_ASSUMPTIONS = (KV_ASSUMPTION_WORST_CASE, KV_ASSUMPTION_TYPICAL)
DEFAULT_KV_ASSUMPTION = KV_ASSUMPTION_WORST_CASE


def dtype_bytes(dtype: str | None) -> float:
    """Bytes per element for ``dtype`` (case-insensitive), defaulting to bf16."""
    key = (dtype or DEFAULT_DTYPE).strip().lower()
    return DTYPE_BYTES.get(key, DTYPE_BYTES[DEFAULT_DTYPE])
