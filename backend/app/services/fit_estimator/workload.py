"""Workload archetypes and the two KV-cache sizing assumptions.

``worst_case`` reserves the full token budget (``max_model_len x max_num_seqs``);
``typical`` scales that budget by an archetype utilization factor loaded from
bundled data. Both are always computed by the estimator; the caller's requested
assumption is merely flagged as primary. The archetype factors are uncalibrated
placeholders (see ``data/workload_archetypes.yaml``).
"""

from __future__ import annotations

import functools
from dataclasses import dataclass
from importlib import resources
from typing import Any

import yaml

from .constants import (
    KV_ASSUMPTION_TYPICAL,
    KV_ASSUMPTION_WORST_CASE,
)

_DATA_PACKAGE = "app.services.fit_estimator.data"
_ARCHETYPE_RESOURCE = "workload_archetypes.yaml"


@dataclass(frozen=True)
class WorkloadArchetype:
    name: str
    utilization_factor: float
    description: str
    source: str


@dataclass(frozen=True)
class ArchetypeTable:
    default_archetype: str
    archetypes: dict[str, WorkloadArchetype]

    def get(self, name: str | None) -> WorkloadArchetype:
        key = (name or self.default_archetype).strip().lower()
        if key not in self.archetypes:
            raise ValueError(
                f"unknown workload archetype {name!r}; "
                f"known: {sorted(self.archetypes)}"
            )
        return self.archetypes[key]


def parse_archetypes(data: Any) -> ArchetypeTable:
    entries = data.get("archetypes", []) if isinstance(data, dict) else data
    archetypes = {
        str(e["name"]).lower(): WorkloadArchetype(
            name=str(e["name"]),
            utilization_factor=float(e["utilization_factor"]),
            description=str(e.get("description", "")),
            source=str(e.get("source", "")),
        )
        for e in entries
    }
    default = str(data.get("default_archetype")) if isinstance(data, dict) else ""
    if default.lower() not in archetypes:
        default = next(iter(archetypes)) if archetypes else ""
    return ArchetypeTable(default_archetype=default, archetypes=archetypes)


@functools.lru_cache(maxsize=1)
def load_archetypes() -> ArchetypeTable:
    text = resources.files(_DATA_PACKAGE).joinpath(_ARCHETYPE_RESOURCE).read_text()
    return parse_archetypes(yaml.safe_load(text))


def assumption_token_counts(
    max_model_len: int,
    max_num_seqs: int,
    archetype: WorkloadArchetype,
) -> dict[str, float]:
    """Token count reserved under each assumption.

    worst_case = full budget; typical = budget x archetype.utilization_factor.
    """
    budget = max_model_len * max_num_seqs
    return {
        KV_ASSUMPTION_WORST_CASE: float(budget),
        KV_ASSUMPTION_TYPICAL: budget * archetype.utilization_factor,
    }
