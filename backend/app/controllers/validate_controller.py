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
from app.services.fit_estimator.validator import ConfigValidation, _empty_breakdown
from app.utils.hf_family_orgs import resolve_request_hf_model

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("", response_model=ValidateConfigResponse)
def validate_launch_config(request: ValidateConfigRequest) -> Any:
    """Certify a proposed vLLM launch config before any resources are touched.

    Contract notes (this endpoint is deliberately STRICTER than the launcher):

    * Worst-case survey: KV is sized at ``max_model_len x DEFAULT_MAX_NUM_SEQS``
      (the vLLM default, 1024 on the V1 engine), so ``valid=false`` here can
      still boot and
      pass the launch gate, which certifies the x1 startup contract.
    * Fail-closed: "cannot verify" is returned as ``valid=false`` with
      ``unverifiable=true``. The launch gate SKIPS such configs instead
      (launch proceeds), so ``valid=false`` + ``unverifiable=true`` does not
      mean the launcher would block it.
    """
    hf_model_id = resolve_request_hf_model(
        request.model_id, request.model_family, request.huggingface_id
    )
    if hf_model_id is None:
        return to_response(
            ConfigValidation(
                valid=False,
                reason=(
                    f"cannot verify {request.model_id!r}: no Hugging Face repo id "
                    "could be resolved for it."
                ),
                per_gpu_breakdown=_empty_breakdown(),
                unverifiable=True,
            )
        )

    result = validate_config_for_model(
        hf_model_id,
        max_model_len=request.max_model_len,
        tensor_parallel_size=request.tensor_parallel_size,
        partition=request.partition,
        resource_type=request.resource_type,
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
