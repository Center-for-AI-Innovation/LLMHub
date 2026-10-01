"""Wire the fit estimator into LLMHub's vec-inf launch path.

LLMHub assigns GPUs from the per-model catalog entry in ``models.yaml``; users
may override partition, job time, context, and concurrency at launch. This
module resolves that catalog + infrastructure defaults + user overrides into the
tuple the validator expects, then certifies the **startup** contract: vLLM
allocates a fixed KV pool from leftover VRAM and aborts at boot if that pool
cannot hold even one full-length sequence. So the gate checks
``weights + KV(max_model_len × 1) + overhead(resolved max_num_seqs) ≤ VRAM``.

The KV budget is sized at ``LAUNCH_GATE_MAX_NUM_SEQS = 1`` (the boot contract),
but the overhead term is sized at the concurrency the job will *actually* boot
with (user override > catalog ``--max-num-seqs`` > the vLLM default, via
:func:`.concurrency.resolve_max_num_seqs`): vLLM's internal reservation grows
0.002 GiB per scheduled sequence, so certifying overhead at mns=1 would
over-promise the real KV pool by ~2 GiB at the V1-engine default 1024.

Concurrency does NOT gate here: beyond the pool vLLM queues/preempts rather than
OOMing, so sustained-concurrency capacity is an informational figure surfaced by
the fit estimator (see :mod:`.capacity`), not a launch blocker.

The gate is skipped (returns ``None``) rather than blocking when it cannot give
an honest verdict about a *supported* configuration:

* the target partition is absent from the bundled Delta hardware table (non-
  Delta infrastructures are unaffected),
* ``num_nodes > 1`` — multi-node splitting (pipeline vs tensor parallel across
  nodes) is not modeled, and curated multi-node catalog entries must not be
  blocked by math we do not have,
* the validator reports the config *unverifiable* (unresolvable model metadata
  — sparse VLM configs, HF outage, gated repo — or non-NVIDIA hardware), and
* the vec-inf catalog entry cannot be loaded (vec-inf will surface its own,
  clearer error if the model is truly unknown).

All skips are logged at WARNING/INFO so unvalidated launches are auditable.
When the validator *can* size the config, its verdict blocks hard — the
fail-closed posture applies to real sizing results, and the explicit
``/api/validate-config`` endpoint stays fail-closed in every case.

Flag precedence mirrors the launch path (:mod:`app.utils.llm_inference` builds
``vllm_args`` as explicit params first, then appends the user's free-form
string; vec-inf overrides per key with later values winning): for
``--max-model-len`` and ``--max-num-seqs``, user free-form ``vllm_args`` >
explicit request params > catalog entry. ``--tensor-parallel-size`` differs —
the launch path never emits it from ``num_gpus``, so a catalog TP flag is what
vLLM actually receives: user ``vllm_args`` > catalog > explicit param >
``gpus_per_node`` (see :func:`resolve_catalog_launch_spec`).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Mapping

from app.config.logging import get_logger
from app.utils.huggingface import resolve_hf_model_id
from app.utils.infrastructure import InfrastructureManager

from .concurrency import resolve_max_num_seqs, vllm_arg_int
from .constants import LAUNCH_GATE_MAX_NUM_SEQS
from .hardware import load_partitions
from .validator import ConfigValidation, _empty_breakdown, validate_config_for_model

logger = get_logger("fit_estimator.launch_gate")

_PARTITION_GPU_CAP_RE = re.compile(r"x(\d+)(?:-|$)")


def max_gpus_for_partition(partition: str) -> int:
    """Max tensor-parallel size for a Delta partition (GPUs per node)."""
    match = _PARTITION_GPU_CAP_RE.search(partition)
    return int(match.group(1)) if match else 4


@dataclass(frozen=True)
class CatalogLaunchSpec:
    """Resolved launch tuple for the memory gate.

    ``max_model_len`` is ``None`` when neither the request, the user's free-form
    ``vllm_args``, nor the catalog pins a context; vLLM then boots at the
    model's native ``max_position_embeddings``, which the validator resolves
    from the fetched model config.

    ``max_num_seqs`` is the concurrency the job will actually boot with; it
    sizes the gate's overhead term, never its KV budget.
    """

    model_name: str
    hf_model_id: str
    partition: str
    max_model_len: int | None
    tensor_parallel_size: int
    num_nodes: int
    max_num_seqs: int


def _model_config_to_dict(model_config: Any) -> dict[str, Any]:
    if isinstance(model_config, dict):
        return model_config
    if hasattr(model_config, "__dict__"):
        return dict(model_config.__dict__)
    return {}


def _resolve_flag(
    user_vllm_args: str | None,
    explicit: int | None,
    catalog_args: Any,
    flag: str,
) -> int | None:
    """Launch-path precedence for a numeric vLLM flag (see module docstring)."""
    user_value = vllm_arg_int(user_vllm_args, flag) if user_vllm_args else None
    if user_value is not None:
        return user_value
    if explicit is not None:
        return explicit
    return vllm_arg_int(catalog_args, flag)


def _coerce_positive_int(value: Any) -> int | None:
    """int() with the crash surface removed (bad catalog values must not 500)."""
    if value is None or isinstance(value, bool):
        return None
    try:
        result = int(value)
    except (TypeError, ValueError):
        return None
    return result if result > 0 else None


# Free-form flags that change vLLM's memory picture in ways this model does not
# capture. If the user sends one, certifying anyway would be a guess dressed up
# as a verdict — skip loudly instead (matched as prefixes: catches --dtype=X,
# --speculative-config, --enable-lora, etc.).
_UNMODELED_MEMORY_FLAG_PREFIXES = (
    "--gpu-memory-utilization",
    "--dtype",
    "--kv-cache-dtype",
    "--quantization",
    "--cpu-offload-gb",
    "--swap-space",
    "--enable-lora",
    "--speculative",
    "--max-num-batched-tokens",
)


def _unmodeled_memory_flags(user_vllm_args: str | None) -> list[str]:
    if not user_vllm_args:
        return []
    present = []
    for prefix in _UNMODELED_MEMORY_FLAG_PREFIXES:
        if prefix in user_vllm_args:
            present.append(prefix)
    return present


def _default_partition() -> str | None:
    mgr = InfrastructureManager()
    default_args = (mgr.get_environment_config() or {}).get("default_args") or {}
    partition = default_args.get("partition")
    return str(partition) if partition else None


def partition_supported(partition: str) -> bool:
    """True when ``partition`` exists in the bundled hardware table."""
    return any(p.partition == partition for p in load_partitions())


def resolve_catalog_launch_spec(
    model_name: str,
    model_config: Mapping[str, Any],
    *,
    hf_model: str | None = None,
    partition: str | None = None,
    max_model_len: int | None = None,
    tensor_parallel_size: int | None = None,
    num_nodes: int | None = None,
    max_num_seqs: int | None = None,
    vllm_args: str | None = None,
) -> CatalogLaunchSpec | None:
    """Build the launch tuple from a vec-inf catalog entry + API overrides.

    ``vllm_args`` is the user's free-form flag string from the deployment
    request; flags in it reach vLLM last and therefore win, so they take
    precedence here too.
    """
    resolved_partition = partition or _default_partition()
    if not resolved_partition:
        logger.warning(
            "Skipping launch memory gate for %s: no partition in request or "
            "infrastructure defaults",
            model_name,
        )
        return None

    if not partition_supported(resolved_partition):
        logger.info(
            "Skipping launch memory gate for %s on %s (partition not in hardware "
            "table)",
            model_name,
            resolved_partition,
        )
        return None

    # Size the model the CLUSTER will actually run. vec-inf prefers local
    # cached weights for the catalog name and drops the request's hf_model when
    # they exist, so a request-supplied hf_model that disagrees with the
    # catalog-derived identity must not steer sizing — otherwise a tiny
    # stand-in repo could earn a confident valid=True for a 70B launch.
    catalog_hf = resolve_hf_model_id(
        model_name,
        family=str(model_config.get("model_family") or ""),
        huggingface_id=model_config.get("huggingface_id"),
    )
    if hf_model and hf_model != catalog_hf and "/" in str(catalog_hf):
        if "/" in hf_model:
            logger.warning(
                "Request hf_model %r differs from catalog-derived %r for %s; "
                "sizing with the catalog identity",
                hf_model,
                catalog_hf,
                model_name,
            )
        resolved_hf = catalog_hf
    else:
        resolved_hf = hf_model or catalog_hf

    catalog_args = model_config.get("vllm_args")
    resolved_max_len = _resolve_flag(
        vllm_args, max_model_len, catalog_args, "--max-model-len"
    )
    if resolved_max_len is None:
        resolved_max_len = _coerce_positive_int(model_config.get("max_model_len"))
    # No context anywhere -> None: vLLM boots at the model's native context, so
    # the validator sizes against max_position_embeddings (never an invented
    # smaller default, which would certify a contract weaker than boot).

    # TP precedence differs from the other flags: llm_inference never emits a
    # --tensor-parallel-size from the num_gpus param (num_gpus only becomes the
    # Slurm gpus_per_node), so a catalog TP flag survives vec-inf's per-key
    # merge and is what vLLM actually boots with. The explicit param applies
    # only when no TP flag exists anywhere (vec-inf then derives TP from
    # gpus_per_node). A conflicting combination (catalog TP != num_gpus) is
    # rejected by vec-inf's own consistency check before reaching vLLM.
    user_tp = vllm_arg_int(vllm_args, "--tensor-parallel-size") if vllm_args else None
    if user_tp is not None:
        resolved_tp = user_tp
    else:
        catalog_tp = vllm_arg_int(catalog_args, "--tensor-parallel-size")
        if catalog_tp is not None:
            resolved_tp = catalog_tp
        elif tensor_parallel_size is not None:
            resolved_tp = tensor_parallel_size
        else:
            resolved_tp = (
                _coerce_positive_int(model_config.get("gpus_per_node"))
                or _coerce_positive_int(model_config.get("num_gpus"))
                or 1
            )
    resolved_tp = max(1, int(resolved_tp))

    resolved_nodes = num_nodes
    if resolved_nodes is None:
        resolved_nodes = _coerce_positive_int(model_config.get("num_nodes")) or 1

    user_mns = vllm_arg_int(vllm_args, "--max-num-seqs") if vllm_args else None
    resolved_mns = resolve_max_num_seqs(
        ui_override=user_mns if user_mns is not None else max_num_seqs,
        catalog_value=vllm_arg_int(catalog_args, "--max-num-seqs"),
    )

    return CatalogLaunchSpec(
        model_name=model_name,
        hf_model_id=str(resolved_hf),
        partition=resolved_partition,
        max_model_len=None if resolved_max_len is None else int(resolved_max_len),
        tensor_parallel_size=int(resolved_tp),
        num_nodes=int(resolved_nodes),
        max_num_seqs=int(resolved_mns),
    )


def check_launch_memory_gate(
    model_name: str,
    model_config: Mapping[str, Any],
    *,
    hf_model: str | None = None,
    partition: str | None = None,
    max_model_len: int | None = None,
    tensor_parallel_size: int | None = None,
    num_nodes: int | None = None,
    max_num_seqs: int | None = None,
    vllm_args: str | None = None,
) -> ConfigValidation | None:
    """Certify a catalog launch config before vec-inf submits Slurm.

    Returns ``None`` when the gate is skipped (unsupported partition or
    multi-node launch). Otherwise returns a :class:`ConfigValidation` verdict
    using the launch contract.
    """
    spec = resolve_catalog_launch_spec(
        model_name,
        model_config,
        hf_model=hf_model,
        partition=partition,
        max_model_len=max_model_len,
        tensor_parallel_size=tensor_parallel_size,
        num_nodes=num_nodes,
        max_num_seqs=max_num_seqs,
        vllm_args=vllm_args,
    )
    if spec is None:
        return None

    if spec.num_nodes > 1:
        logger.warning(
            "Skipping launch memory gate for %s: multi-node launch "
            "(num_nodes=%s) is not modeled; proceeding unvalidated",
            model_name,
            spec.num_nodes,
        )
        return None

    unmodeled = _unmodeled_memory_flags(vllm_args)
    if unmodeled:
        logger.warning(
            "Skipping launch memory gate for %s: user vllm_args carry "
            "memory-relevant flags this model does not capture (%s); "
            "certifying anyway would be a guess. Launch proceeds unvalidated.",
            model_name,
            ", ".join(unmodeled),
        )
        return None

    partition_cap = max_gpus_for_partition(spec.partition)
    if spec.tensor_parallel_size > partition_cap:
        return ConfigValidation(
            valid=False,
            reason=(
                f"tensor_parallel_size ({spec.tensor_parallel_size}) exceeds "
                f"{spec.partition} capacity ({partition_cap} GPUs per node)."
            ),
            per_gpu_breakdown=_empty_breakdown(),
        )

    logger.info(
        "Launch startup gate: model=%s hf=%s partition=%s max_model_len=%s "
        "tp=%s nodes=%s mns=%s (boot contract: KV pool at overhead(mns) must "
        "hold 1 full-context seq)",
        spec.model_name,
        spec.hf_model_id,
        spec.partition,
        spec.max_model_len,
        spec.tensor_parallel_size,
        spec.num_nodes,
        spec.max_num_seqs,
    )

    verdict = validate_config_for_model(
        spec.hf_model_id,
        max_model_len=spec.max_model_len,
        tensor_parallel_size=spec.tensor_parallel_size,
        partition=spec.partition,
        num_nodes=spec.num_nodes,
        max_num_seqs=LAUNCH_GATE_MAX_NUM_SEQS,
        overhead_max_num_seqs=spec.max_num_seqs,
    )
    if verdict.unverifiable:
        # "Cannot model this" is not "will not boot": model weights are already
        # local on the cluster, and these launches predate the gate. Blocking
        # curated models over sparse VLM configs or an HF outage is a worse
        # failure than skipping — so skip loudly and let vec-inf proceed.
        logger.warning(
            "Skipping launch memory gate for %s on %s: %s (launch proceeds "
            "unvalidated)",
            spec.model_name,
            spec.partition,
            verdict.reason,
        )
        return None
    return verdict


def check_launch_memory_gate_for_model(
    model_name: str,
    get_model_details: Any,
    **launch_overrides: Any,
) -> ConfigValidation | None:
    """Resolve catalog config via vec-inf, then run :func:`check_launch_memory_gate`."""
    details_result = get_model_details(model_name)
    if not details_result.get("success"):
        # If the catalog entry is truly missing, vec-inf fails the launch with
        # its own (clearer) error; a broken catalog must not block via ours.
        logger.warning(
            "Skipping launch memory gate for %s: failed to load catalog config "
            "(%s); launch proceeds unvalidated",
            model_name,
            details_result.get("error", "unknown error"),
        )
        return None

    model_config = _model_config_to_dict(details_result.get("details") or {})
    return check_launch_memory_gate(
        model_name,
        model_config,
        hf_model=launch_overrides.get("hf_model"),
        partition=launch_overrides.get("partition"),
        max_model_len=launch_overrides.get("max_model_len"),
        tensor_parallel_size=launch_overrides.get("tensor_parallel_size"),
        num_nodes=launch_overrides.get("num_nodes"),
        max_num_seqs=launch_overrides.get("max_num_seqs"),
        vllm_args=launch_overrides.get("vllm_args"),
    )
