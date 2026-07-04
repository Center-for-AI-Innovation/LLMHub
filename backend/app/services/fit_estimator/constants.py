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

# Fallback framework overhead (GiB) used only if a partition entry in the
# hardware YAML omits ``framework_overhead_gib``. The real per-partition values
# live in the YAML so they are swappable when the calibration sweep lands.
DEFAULT_FRAMEWORK_OVERHEAD_GIB = 2.0

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
