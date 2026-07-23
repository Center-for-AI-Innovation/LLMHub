"""Controller for the pre-launch config validation gate.

Thin wrapper over ``app.services.fit_estimator.validator``. The gate always
returns a verdict (HTTP 200 with ``valid: true/false``); it never passes by
default. Unresolvable models / unknown partitions come back as
``valid: false`` with a "cannot verify" or specific reason, not an error.
Malformed requests (e.g. missing ``max_model_len``) are rejected by request
validation as HTTP 422.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter

from app.schemas.validate_config import (
    ValidateConfigRequest,
    ValidateConfigResponse,
    to_response,
)
from app.services.fit_estimator import validate_config_for_model
from app.utils.huggingface import resolve_hf_model_id

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("", response_model=ValidateConfigResponse)
def validate_launch_config(request: ValidateConfigRequest) -> Any:
    """Certify a proposed vLLM launch config before any resources are touched."""
    result = validate_config_for_model(
        resolve_hf_model_id(
            request.model_id,
            family=request.model_family,
            huggingface_id=request.huggingface_id,
        ),
        max_model_len=request.max_model_len,
        tensor_parallel_size=request.tensor_parallel_size,
        partition=request.partition,
        num_nodes=request.num_nodes,
        dtype=request.dtype,
        revision=request.revision,
    )
    if not result.valid:
        logger.info(
            "validate-config rejected %s on %s: %s",
            request.model_id,
            request.partition,
            result.reason,
        )
    return to_response(result)
