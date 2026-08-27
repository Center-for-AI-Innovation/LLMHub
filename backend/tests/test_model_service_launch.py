"""Launch-path tests for ModelService.launch_model (mocked infra, no network).

These pin the resource-accounting contract around the memory gate:
allocation released on gate-block, launch proceeding on gate-crash
(fail-open), and the num_nodes=None regression (model_dump always emits the
key, so dict-get defaults never fire).
"""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

import pytest

import app.services.model_service as ms
from app.schemas.model_deployment import ModelDeploymentCreate
from app.services.fit_estimator.validator import ConfigValidation, _empty_breakdown


@pytest.fixture()
def service(monkeypatch: pytest.MonkeyPatch) -> ms.ModelService:
    svc = ms.ModelService.__new__(ms.ModelService)
    svc.llm_client = MagicMock()
    svc.llm_client.launch_model.return_value = {
        "success": True,
        "slurm_job_id": "424242",
        "job_id": "424242",
    }
    return svc


@pytest.fixture()
def resource_service(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    instance = MagicMock()
    instance.allocate_resources.return_value = {"success": True}
    monkeypatch.setattr(ms, "ResourceService", MagicMock(return_value=instance))
    return instance


def _deployment(**overrides):
    payload = {
        "modelName": "Qwen2.5-7B-Instruct",
        "userId": uuid4(),
        "num_gpus": 2,
        "partition": "gpuA40x4",
    }
    payload.update(overrides)
    return ModelDeploymentCreate(**payload)


def test_launch_survives_num_nodes_none(
    service: ms.ModelService,
    resource_service: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """model_dump() always emits num_nodes=None; the old dict-get default never
    fired and num_gpus * None raised TypeError before allocation."""
    monkeypatch.setattr(ms, "check_launch_memory_gate_for_model", lambda *a, **k: None)
    db = MagicMock()

    result = service.launch_model(db, _deployment())

    resource_service.allocate_resources.assert_called_once()
    assert resource_service.allocate_resources.call_args.kwargs["count"] == 2
    service.llm_client.launch_model.assert_called_once()
    assert result.slurmJobId == "424242"


def test_gate_block_releases_allocation(
    service: ms.ModelService,
    resource_service: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    verdict = ConfigValidation(
        valid=False,
        reason="Config exceeds A40 VRAM",
        per_gpu_breakdown=_empty_breakdown(),
    )
    monkeypatch.setattr(
        ms, "check_launch_memory_gate_for_model", lambda *a, **k: verdict
    )
    db = MagicMock()

    result = service.launch_model(db, _deployment())

    resource_service.release_resources.assert_called_once()
    assert resource_service.release_resources.call_args.kwargs["count"] == 2
    service.llm_client.launch_model.assert_not_called()
    assert result.status == "failed"
    assert result.errorMessage.startswith("Launch blocked:")


def test_gate_crash_fails_open(
    service: ms.ModelService,
    resource_service: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An estimator bug must not take down launches or leak the allocation."""

    def _boom(*_a, **_k):
        raise RuntimeError("estimator bug")

    monkeypatch.setattr(ms, "check_launch_memory_gate_for_model", _boom)
    db = MagicMock()

    result = service.launch_model(db, _deployment())

    service.llm_client.launch_model.assert_called_once()
    resource_service.release_resources.assert_not_called()
    assert result.slurmJobId == "424242"
