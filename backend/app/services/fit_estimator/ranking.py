"""Partition ranking -- INTENTIONALLY UNIMPLEMENTED (seam only).

This branch scopes to fit estimation. Cost/throughput ranking (cheapest SU/hr,
total job cost, tokens/sec) is a follow-up. The interface is fixed here so the
estimator output is ranking-ready, but calling it raises rather than returning a
misleading order.

TODO(ranking-layer): rank feasible partitions. SU/hr rate is available on each
GpuPartition, but total job cost = rate x runtime and runtime depends on
throughput, which is not modeled yet -- so do not rank on rate alone.
"""

from __future__ import annotations

from typing import Sequence

from .estimator import PartitionFit


def rank_partitions(fits: Sequence[PartitionFit]) -> list[PartitionFit]:
    """Rank feasible partitions best-first. Not implemented on this branch."""
    raise NotImplementedError(
        "partition ranking is not implemented on feat/gpu-fit-estimator; "
        "the fit estimator returns unranked per-partition results"
    )
