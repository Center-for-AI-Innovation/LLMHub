"""Controller for pre-flight GPU fit estimation.

Thin HTTP wrapper: validate the request, call the pure estimator (which does its
own metadata fetch), and serialize. All memory logic lives in
``app.services.fit_estimator``; this layer only translates errors to HTTP codes.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, status

from app.schemas.fit_estimate import (
    FitEstimateRequest,
    FitEstimateResponse,
    to_response,
)
from app.services.fit_estimator import estimate_fit_for_model
from app.services.fit_estimator.ranking import parse_duration_hours
from app.utils.huggingface import resolve_hf_model_id

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("", response_model=FitEstimateResponse)
def create_fit_estimate(request: FitEstimateRequest) -> Any:
    """Estimate per-partition GPU fit for a model + workload on Delta."""
    duration_hours = request.duration_hours
    if duration_hours is None and request.time:
        try:
            duration_hours = parse_duration_hours(request.time)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
            ) from exc

    try:
        hf_model_id = resolve_hf_model_id(
            request.model_id,
            family=request.model_family,
            huggingface_id=request.huggingface_id,
        )
        estimate = estimate_fit_for_model(
            hf_model_id,
            dtype=request.dtype,
            max_model_len=request.max_model_len,
            max_num_seqs=request.max_num_seqs,
            kv_assumption=request.kv_assumption,
            workload_archetype=request.workload_archetype,
            tensor_parallel_size=request.tensor_parallel_size,
            duration_hours=duration_hours,
            typical_seq_len=request.typical_seq_len,
            revision=request.revision,
        )
    except ValueError as exc:
        # Bad model id / missing config / unknown archetype: caller error.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    except Exception as exc:  # pragma: no cover - network/HTTP failures
        logger.exception("Fit estimate failed for %s", request.model_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch model metadata: {exc}",
        ) from exc

    return to_response(estimate)
