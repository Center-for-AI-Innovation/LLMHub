"""Single source of truth for effective vLLM concurrency (``--max-num-seqs``).

Precedence (documented contract):
    1. ``ui_override`` — user explicitly set concurrency in the launch dialog
    2. ``catalog_value`` — curated ``models.yaml`` ``vllm_args['--max-num-seqs']``
    3. ``VLLM_DEFAULT_MAX_NUM_SEQS`` (256) — vLLM built-in default

All fit certification, launch-gate checks, and optional deploy overrides must
read the resolved value from :func:`resolve_max_num_seqs`; no path should pick
its own concurrency constant independently.
"""

from __future__ import annotations

from typing import Any, Mapping

from .constants import DEFAULT_MAX_NUM_SEQS as VLLM_DEFAULT_MAX_NUM_SEQS

__all__ = [
    "VLLM_DEFAULT_MAX_NUM_SEQS",
    "catalog_max_num_seqs",
    "resolve_max_num_seqs",
    "vllm_arg_int",
]


def vllm_arg_int(vllm_args: Any, flag: str) -> int | None:
    """Read a numeric vLLM CLI flag from catalog ``vllm_args`` (dict or string)."""
    if isinstance(vllm_args, dict):
        raw = vllm_args.get(flag)
        if raw is not None:
            return int(raw)
        return None

    if isinstance(vllm_args, str) and flag in vllm_args:
        tail = vllm_args.split(flag, 1)[1].strip()
        if tail.startswith("="):
            tail = tail[1:].strip()
        try:
            return int(tail.split()[0])
        except (ValueError, IndexError):
            return None

    return None


def catalog_max_num_seqs(model_config: Mapping[str, Any]) -> int | None:
    """Return curated ``--max-num-seqs`` from a vec-inf catalog entry, if set."""
    return vllm_arg_int(model_config.get("vllm_args"), "--max-num-seqs")


def resolve_max_num_seqs(
    *,
    ui_override: int | None = None,
    catalog_value: int | None = None,
) -> int:
    """Effective concurrency for fit checks and vLLM launch.

    Parameters
    ----------
    ui_override:
        Set only when the user deliberately changed concurrency in the UI.
        ``None`` means "use catalog / vLLM default".
    catalog_value:
        Parsed ``--max-num-seqs`` from ``models.yaml`` for this model.
    """
    if ui_override is not None:
        return int(ui_override)
    if catalog_value is not None:
        return int(catalog_value)
    return VLLM_DEFAULT_MAX_NUM_SEQS
