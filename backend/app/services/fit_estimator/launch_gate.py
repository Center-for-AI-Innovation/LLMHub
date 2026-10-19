"""Wire the fit estimator into LLMHub's vec-inf launch path.

LLMHub assigns GPUs from the per-model catalog entry in ``models.yaml``; users
may override partition, GPU count, job time, context, and concurrency at
launch. This module resolves that catalog + infrastructure defaults + request
params into the tuple the validator expects, then certifies the **startup** contract: vLLM
allocates a fixed KV pool from leftover VRAM and aborts at boot if that pool
cannot hold even one full-length sequence. So the gate checks
``weights + KV(max_model_len × 1) + overhead(resolved max_num_seqs) ≤ VRAM``.

The KV budget is sized at ``LAUNCH_GATE_MAX_NUM_SEQS = 1`` (the boot contract),
but the overhead term is sized at the concurrency the job will *actually* boot
with (request param > catalog ``--max-num-seqs`` > the vLLM default, via
:func:`.concurrency.resolve_max_num_seqs`): vLLM's internal reservation grows
0.002 GiB per scheduled sequence, so certifying overhead at mns=1 would
over-promise the real KV pool by ~2 GiB at the V1-engine default 1024.

Concurrency does NOT gate here: beyond the pool vLLM queues/preempts rather than
OOMing, so sustained-concurrency capacity is an informational figure surfaced by
the fit estimator (see :mod:`.capacity`), not a launch blocker.

The gate is skipped (returns ``None``) rather than blocking when it cannot give
an honest verdict about a *supported* configuration:

* the target partition is absent from this cluster's hardware table, or it
  mixes GPU types and the request does not say which one (see
  :func:`.hardware.find_partition`),
* ``num_nodes > 1`` — multi-node splitting (pipeline vs tensor parallel across
  nodes) is not modeled, and curated multi-node catalog entries must not be
  blocked by math we do not have,
* the catalog entry carries vLLM flags that change memory in ways the model
  does not capture (``--gpu-memory-utilization``, ``--dtype``, LoRA, ...),
* the validator reports the config *unverifiable* (unresolvable model metadata
  — sparse VLM configs, HF outage, a gated repo the user's token cannot read —
  or non-NVIDIA hardware), and
* the vec-inf catalog entry cannot be loaded (vec-inf will surface its own,
  clearer error if the model is truly unknown).

All skips are logged at WARNING/INFO so unvalidated launches are auditable.
When the validator *can* size the config, a failing verdict is a warning,
not a refusal: ``launch_model`` launches anyway and attaches the verdict's
reason to the deployment, and to its error if the job fails. The estimate is
calibrated, not exact, and drifts with vLLM and driver versions. The explicit
``/api/validate-config`` endpoint stays fail-closed in every case.

Flag precedence mirrors the launch path. Clients cannot send free-form
``vllm_args`` (the backend drops them), so :mod:`app.utils.llm_inference` emits
only flags built from explicit request params, and vec-inf overrides the
catalog's per key: request param > catalog entry for ``--max-model-len``,
``--max-num-seqs`` and ``--tensor-parallel-size`` (the last emitted from
``num_gpus``). Without a request value, TP falls back to the catalog flag, then
``gpus_per_node`` (see :func:`resolve_catalog_launch_spec`).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from app.config.logging import get_logger
from app.utils.hf_family_orgs import resolve_hf_model
from app.utils.infrastructure import InfrastructureManager

from .concurrency import resolve_max_num_seqs, vllm_arg_int
from .constants import LAUNCH_GATE_MAX_NUM_SEQS
from .hardware import find_partition, load_partitions
from .validator import ConfigValidation, _empty_breakdown, validate_config_for_model

logger = get_logger("fit_estimator.launch_gate")


@dataclass(frozen=True)
class CatalogLaunchSpec:
    """Resolved launch tuple for the memory gate.

    ``max_model_len`` is ``None`` when neither the request nor the catalog
    pins a context; vLLM then boots at the model's native
    ``max_position_embeddings``, which the validator resolves from the fetched
    model config.

    ``max_num_seqs`` is the concurrency the job will actually boot with; it
    sizes the gate's overhead term, never its KV budget.
    """

    model_name: str
    hf_model_id: str
    partition: str
    resource_type: str | None
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


def _resolve_flag(explicit: int | None, catalog_args: Any, flag: str) -> int | None:
    """Launch-path precedence for a numeric vLLM flag (see module docstring)."""
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


# Catalog flags that change vLLM's memory picture in ways this model does not
# capture. If a catalog entry carries one, certifying anyway would be a guess
# dressed up as a verdict — skip loudly instead (matched as prefixes: catches
# --dtype=X, --speculative-config, --enable-lora, etc.).
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


def _unmodeled_memory_flags(catalog_args: Any) -> list[str]:
    if isinstance(catalog_args, Mapping):
        flags = " ".join(str(key) for key in catalog_args)
    elif isinstance(catalog_args, str):
        flags = catalog_args
    else:
        return []
    return [p for p in _UNMODELED_MEMORY_FLAG_PREFIXES if p in flags]


def _default_arg(name: str) -> str | None:
    mgr = InfrastructureManager()
    default_args = (mgr.get_environment_config() or {}).get("default_args") or {}
    value = default_args.get(name)
    return str(value) if value else None


def _default_partition() -> str | None:
    return _default_arg("partition")


def _default_resource_type() -> str | None:
    """vec-inf fills an omitted resource_type from the same default."""
    return _default_arg("resource_type")


def resolve_catalog_launch_spec(
    model_name: str,
    model_config: Mapping[str, Any],
    *,
    hf_model: str | None = None,
    partition: str | None = None,
    resource_type: str | None = None,
    max_model_len: int | None = None,
    tensor_parallel_size: int | None = None,
    num_nodes: int | None = None,
    max_num_seqs: int | None = None,
) -> CatalogLaunchSpec | None:
    """Build the launch tuple from a vec-inf catalog entry + request params.

    ``hf_model`` is the server-resolved repo id (``AvailableModel.huggingfaceId``
    in the launch path), never a client value.
    """
    resolved_partition = partition or _default_partition()
    if not resolved_partition:
        logger.warning(
            "Skipping launch memory gate for %s: no partition in request or "
            "infrastructure defaults",
            model_name,
        )
        return None

    resolved_resource_type = resource_type or _default_resource_type()
    gpu, lookup_error = find_partition(
        resolved_partition, resolved_resource_type, load_partitions()
    )
    if gpu is None:
        logger.info("Skipping launch memory gate for %s: %s", model_name, lookup_error)
        return None

    resolved_hf = hf_model or resolve_hf_model(
        str(model_config.get("model_family") or ""),
        model_name,
        model_config.get("hf_model"),
    )
    if not resolved_hf:
        logger.warning(
            "Skipping launch memory gate for %s: no Hugging Face repo id in the "
            "catalog and its model_family has no known org",
            model_name,
        )
        return None

    catalog_args = model_config.get("vllm_args")
    resolved_max_len = _resolve_flag(max_model_len, catalog_args, "--max-model-len")
    if resolved_max_len is None:
        resolved_max_len = _coerce_positive_int(model_config.get("max_model_len"))
    # No context anywhere -> None: vLLM boots at the model's native context, so
    # the validator sizes against max_position_embeddings (never an invented
    # smaller default, which would certify a contract weaker than boot).

    # llm_inference emits --tensor-parallel-size from num_gpus, which overrides
    # the catalog flag in vec-inf's per-key merge. Without num_gpus the catalog
    # flag stands, and without that vec-inf derives TP from gpus_per_node.
    resolved_tp = _resolve_flag(
        tensor_parallel_size, catalog_args, "--tensor-parallel-size"
    )
    if resolved_tp is None:
        resolved_tp = (
            _coerce_positive_int(model_config.get("gpus_per_node"))
            or _coerce_positive_int(model_config.get("num_gpus"))
            or 1
        )
    resolved_tp = max(1, int(resolved_tp))

    resolved_nodes = num_nodes
    if resolved_nodes is None:
        resolved_nodes = _coerce_positive_int(model_config.get("num_nodes")) or 1

    resolved_mns = resolve_max_num_seqs(
        ui_override=max_num_seqs,
        catalog_value=vllm_arg_int(catalog_args, "--max-num-seqs"),
    )

    return CatalogLaunchSpec(
        model_name=model_name,
        hf_model_id=str(resolved_hf),
        partition=resolved_partition,
        resource_type=resolved_resource_type,
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
    resource_type: str | None = None,
    max_model_len: int | None = None,
    tensor_parallel_size: int | None = None,
    num_nodes: int | None = None,
    max_num_seqs: int | None = None,
    hf_token: str | None = None,
) -> ConfigValidation | None:
    """Certify a catalog launch config before vec-inf submits Slurm.

    Returns ``None`` when the gate is skipped (see the module docstring).
    Otherwise returns a :class:`ConfigValidation` verdict using the launch
    contract. ``hf_token`` is the requesting user's own token, used only to
    read a gated repo's metadata.
    """
    spec = resolve_catalog_launch_spec(
        model_name,
        model_config,
        hf_model=hf_model,
        partition=partition,
        resource_type=resource_type,
        max_model_len=max_model_len,
        tensor_parallel_size=tensor_parallel_size,
        num_nodes=num_nodes,
        max_num_seqs=max_num_seqs,
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

    unmodeled = _unmodeled_memory_flags(model_config.get("vllm_args"))
    if unmodeled:
        logger.warning(
            "Skipping launch memory gate for %s: catalog vllm_args carry "
            "memory-relevant flags this model does not capture (%s); "
            "certifying anyway would be a guess. Launch proceeds unvalidated.",
            model_name,
            ", ".join(unmodeled),
        )
        return None

    gpu, _ = find_partition(spec.partition, spec.resource_type, load_partitions())
    if (
        gpu is not None
        and gpu.gpus_per_node is not None
        and spec.tensor_parallel_size > gpu.gpus_per_node
    ):
        return ConfigValidation(
            valid=False,
            reason=(
                f"tensor_parallel_size ({spec.tensor_parallel_size}) exceeds "
                f"{spec.partition} capacity ({gpu.gpus_per_node} GPUs per node)."
            ),
            per_gpu_breakdown=_empty_breakdown(),
        )

    logger.info(
        "Launch startup gate: model=%s hf=%s partition=%s resource_type=%s "
        "max_model_len=%s tp=%s nodes=%s mns=%s (boot contract: KV pool at "
        "overhead(mns) must hold 1 full-context seq)",
        spec.model_name,
        spec.hf_model_id,
        spec.partition,
        spec.resource_type,
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
        resource_type=spec.resource_type,
        num_nodes=spec.num_nodes,
        max_num_seqs=LAUNCH_GATE_MAX_NUM_SEQS,
        overhead_max_num_seqs=spec.max_num_seqs,
        hf_token=hf_token,
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
        resource_type=launch_overrides.get("resource_type"),
        max_model_len=launch_overrides.get("max_model_len"),
        tensor_parallel_size=launch_overrides.get("tensor_parallel_size"),
        num_nodes=launch_overrides.get("num_nodes"),
        max_num_seqs=launch_overrides.get("max_num_seqs"),
        hf_token=launch_overrides.get("hf_token"),
    )
