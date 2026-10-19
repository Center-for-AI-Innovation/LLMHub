"""Single source of truth for effective vLLM concurrency (``--max-num-seqs``).

Precedence (documented contract):
    1. ``ui_override`` — user explicitly set concurrency in the launch dialog
    2. ``catalog_value`` — curated ``models.yaml`` ``vllm_args['--max-num-seqs']``
    3. ``VLLM_DEFAULT_MAX_NUM_SEQS`` (1024, the V1-engine default; V0 was 256)

All fit certification, launch-gate checks, and optional deploy overrides must
read the resolved value from :func:`resolve_max_num_seqs`; no path should pick
its own concurrency constant independently.
"""

from __future__ import annotations

import re
from typing import Any, Mapping

from .constants import DEFAULT_MAX_NUM_SEQS as VLLM_DEFAULT_MAX_NUM_SEQS

__all__ = [
    "VLLM_DEFAULT_MAX_NUM_SEQS",
    "catalog_max_num_seqs",
    "resolve_max_num_seqs",
    "vllm_arg_int",
]


def vllm_arg_int(vllm_args: Any, flag: str) -> int | None:
    """Read a numeric vLLM CLI flag from ``vllm_args`` (dict or string).

    String form must handle BOTH separators: CLI style (``--flag=1 --other=2``,
    whitespace) and the vec-inf wire format that LLMHub actually sends
    (``--flag=1,--other=2``, comma-joined — see
    ``llm_inference._build_launch_options``). Parsing only the last flag of a
    comma-joined string once silently dropped every earlier flag.
    """
    if isinstance(vllm_args, dict):
        raw = vllm_args.get(flag)
        # bool is an int subclass: a YAML `--max-model-len: yes` would silently
        # become 1 and the gate would certify a context of one token.
        if raw is None or isinstance(raw, bool):
            return None
        try:
            return int(raw)
        except (TypeError, ValueError):
            return None

    if isinstance(vllm_args, str) and flag in vllm_args:
        tail = vllm_args.split(flag, 1)[1].strip()
        if tail.startswith("="):
            tail = tail[1:].strip()
        value = re.split(r"[\s,]", tail, maxsplit=1)[0]
        try:
            return int(value)
        except ValueError:
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
    # Clamp to >= 1: a zero/negative override would make the overhead model
    # raise inside the gate, and a crash must never be the cheap way past it.
    if ui_override is not None:
        return max(1, int(ui_override))
    if catalog_value is not None:
        return max(1, int(catalog_value))
    return VLLM_DEFAULT_MAX_NUM_SEQS
