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

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("", response_model=FitEstimateResponse)
def create_fit_estimate(request: FitEstimateRequest) -> Any:
    """Estimate per-partition GPU fit for a model + workload on Delta."""
    try:
        estimate = estimate_fit_for_model(
            request.model_id,
            dtype=request.dtype,
            max_model_len=request.max_model_len,
            max_num_seqs=request.max_num_seqs,
            kv_assumption=request.kv_assumption,
            workload_archetype=request.workload_archetype,
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
