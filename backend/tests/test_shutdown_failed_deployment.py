"""#101: a DELETE cancels a deployment whose row says failed while its job runs.

vec-inf can report a job FAILED from a line in its log while Slurm still runs
it, and the row then says ``failed``. Each test sends the real
``DELETE /api/models/deployments/{id}`` through ``ModelService`` and
``LLMInferenceClient`` in impersonate mode. The impersonation wrapper is a
script that records its arguments, so the test sees exactly what would be run
as the cluster user. Slurm's view of the job comes from a fake ``sacct``.
"""

import os
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config.config import settings
from app.controllers import model_controller
from app.models.model_deployment import ModelDeployment
from app.repositories.session import get_db
from app.utils import llm_inference

USER = "svcllmhubtest"
JOB = "3277706"
FAKE_WRAPPER = """#!/bin/sh
printf '%s\\n' "$*" >> "$WRAPPER_LOG"
"""
# Prints sacct's -P rows for the job, or fails when FAKE_SACCT_STATE is unset.
FAKE_SACCT = """#!/bin/sh
printf '%s\\n' "$*" >> "$SACCT_LOG"
[ -n "$FAKE_SACCT_STATE" ] || { echo "sacct: error: slurmdbd unreachable" >&2; exit 1; }
printf '%s|%s\\n%s.batch|%s\\n' "$FAKE_SACCT_JOB" "$FAKE_SACCT_STATE" \\
    "$FAKE_SACCT_JOB" "$FAKE_SACCT_STATE"
"""


@pytest.fixture
def api(monkeypatch, tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "sacct").write_text(FAKE_SACCT)
    (bin_dir / "sacct").chmod(0o755)
    wrapper = tmp_path / "impersonate-wrapper"
    wrapper.write_text(FAKE_WRAPPER)
    wrapper.chmod(0o755)
    (tmp_path / "work" / USER).mkdir(parents=True)
    wrapper_log, sacct_log = tmp_path / "wrapper.log", tmp_path / "sacct.log"
    wrapper_log.touch()
    sacct_log.touch()
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("WRAPPER_LOG", str(wrapper_log))
    monkeypatch.setenv("SACCT_LOG", str(sacct_log))
    monkeypatch.setenv("FAKE_SACCT_JOB", JOB)
    monkeypatch.setattr(settings, "VEC_INF_EXECUTION_MODE", "impersonate")
    monkeypatch.setattr(settings, "VEC_INF_IMPERSONATE_SCRIPT", str(wrapper))
    monkeypatch.setattr(settings, "VEC_INF_SHARED_WORK_ROOT", str(tmp_path / "work"))

    released = []

    class _Resources:
        def release_resources(self, **kwargs):
            released.append(kwargs["count"])
            return {"success": True}

    monkeypatch.setattr(
        "app.services.model_service.ResourceService", lambda: _Resources()
    )
    monkeypatch.setattr(
        model_controller.model_service, "llm_client", llm_inference.LLMInferenceClient()
    )

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    ModelDeployment.__table__.create(engine)
    db = sessionmaker(bind=engine)()
    app = FastAPI()
    app.include_router(model_controller.router, prefix="/api/models")
    app.dependency_overrides[get_db] = lambda: db

    class Api:
        def __init__(self):
            self.client = TestClient(app)
            self.db = db
            self.released = released

        def deployment(self, status, job=JOB, error=None):
            row = ModelDeployment(
                id=uuid.uuid4(),
                modelId="Qwen2.5-7B-Instruct",
                modelName="Qwen2.5-7B-Instruct",
                userId=uuid.uuid4(),
                slurmJobId=job,
                status=status,
                errorMessage=error,
                resourceAllocation={
                    "cluster_username": USER,
                    "num_gpus": 4,
                    "num_nodes": 2,
                },
            )
            db.add(row)
            db.commit()
            return row

        def delete(self, row):
            response = self.client.delete(f"/api/models/deployments/{row.id}")
            assert response.status_code == 200, response.text
            return response.json()

        @staticmethod
        def wrapper_calls():
            return wrapper_log.read_text().splitlines()

        @staticmethod
        def sacct_calls():
            return sacct_log.read_text().splitlines()

    yield Api()
    db.close()


SCANCEL_AS_USER = f"--no-login-shell {USER} -- scancel {JOB}"
FALSE_FAILURE = (
    "libfabric:...:cxip_nic_get_rgroup_vni():264<warn> gh063: "
    "Failed to find valid default rgroup and vni for cxi0"
)


def test_a_running_deployment_is_cancelled_as_its_user(api):
    """The control: the path a failed row must take too."""
    row = api.deployment("running")

    body = api.delete(row)

    assert api.wrapper_calls() == [SCANCEL_AS_USER]
    assert body["status"] == "shutdown"
    assert api.released == [8]


@pytest.mark.parametrize("state", ["RUNNING", "PENDING"])
def test_a_failed_row_whose_job_is_live_is_cancelled_like_a_running_one(
    api, monkeypatch, state
):
    monkeypatch.setenv("FAKE_SACCT_STATE", state)
    row = api.deployment("failed", error=FALSE_FAILURE)

    body = api.delete(row)

    assert api.sacct_calls() and JOB in api.sacct_calls()[0]
    assert api.wrapper_calls() == [SCANCEL_AS_USER]
    assert body["status"] == "shutdown"
    assert body["errorMessage"] is None
    assert api.released == [8]


@pytest.mark.parametrize(
    "state", ["FAILED", "CANCELLED by 93365", "TIMEOUT", "COMPLETED", "NODE_FAIL"]
)
def test_a_failed_row_whose_job_has_ended_is_not_cancelled_again(
    api, monkeypatch, state
):
    monkeypatch.setenv("FAKE_SACCT_STATE", state)
    row = api.deployment("failed", error="Slurm job timeout")

    body = api.delete(row)

    assert api.sacct_calls(), "sacct was never asked"
    assert api.wrapper_calls() == []
    assert body["status"] == "failed"
    assert body["errorMessage"] == "Slurm job timeout"
    assert api.released == []


def test_a_failed_launch_without_a_job_never_asks_slurm(api):
    row = api.deployment("failed", job="failed", error="Unknown model")

    body = api.delete(row)

    assert api.sacct_calls() == []
    assert api.wrapper_calls() == []
    assert body["status"] == "failed"


def test_a_failed_row_is_left_alone_when_slurm_cannot_say(api, monkeypatch):
    monkeypatch.delenv("FAKE_SACCT_STATE", raising=False)
    row = api.deployment("failed", error=FALSE_FAILURE)

    body = api.delete(row)

    assert api.sacct_calls(), "sacct was never asked"
    assert api.wrapper_calls() == []
    assert body["status"] == "failed"
