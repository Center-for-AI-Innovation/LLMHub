"""Launch layouts (#112) and the shapes the API refuses (#175).

Each request goes through the real ``POST /api/models/deployments`` route,
``ModelService`` and ``LLMInferenceClient`` in direct mode, down to vec-inf's
own launch against a fake ``sbatch`` that records the script it is handed.
Slurm's answer about the partition comes from a fake ``sinfo``. A refused
request must be answered 422 with its reason, and leave nothing behind: no
vec-inf launcher built, no script submitted, no download started, no row.
"""

import os

import pytest
import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient
from multinode_helpers import FAKE_SBATCH, FIXTURE_VEC_INF_ENV
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from vec_inf.client import _helper

from app.config.config import VecInfExecutionMode, settings
from app.controllers import model_controller
from app.models.available_model import AvailableModel
from app.models.model_deployment import ModelDeployment
from app.repositories.session import get_db
from app.utils import launch_layout, llm_inference, vec_inf_multinode

USER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
PARTITION = "ghx4-interactive"
# What DeltaAI's `sinfo --all --noheader --format '%P|%s|%G'` answers
# (gh-login03, 2026-11-10): ghx4-interactive takes 1-2 nodes of 4 GPUs.
SINFO_DELTAAI = (
    "full|1-infinite|gpu:nvidia_gh200_120gb:4(S:0-3)\n"
    "test|1-infinite|gpu:nvidia_gh200_120gb:4(S:0-3)\n"
    "ghx4*|1-infinite|gpu:nvidia_gh200_120gb:4(S:0-3)\n"
    "ghx4-interactive|1-2|gpu:nvidia_gh200_120gb:4(S:0-3)\n"
)
FAKE_SINFO = """#!/bin/sh
printf '%s' "$FAKE_SINFO_OUT"
"""


def _entry(gpus, nodes, engine="vllm", **engine_args):
    return {
        "model_family": "Test",
        "model_variant": f"{nodes}x{gpus}",
        "model_type": "LLM",
        "gpus_per_node": gpus,
        "num_nodes": nodes,
        "vocab_size": 152064,
        "partition": PARTITION,
        "engine": engine,
        f"{engine}_args": {"--max-model-len": 4096, **engine_args},
    }


TP = "--tensor-parallel-size"
PP = "--pipeline-parallel-size"
CATALOG = {
    # A 1-node entry whose layout is not TP = GPUs per node: what #112 lost.
    "Tuned-1x4": _entry(4, 1, **{TP: 2, PP: 2}),
    "Plain-1x4": _entry(4, 1, **{TP: 4}),
    "Plain-2x4": _entry(4, 2, **{TP: 4, PP: 2}),
    # TP across nodes: the Mllama shape Delta's catalog still has.
    "Wide-2x4": _entry(4, 2, **{TP: 8}),
    "Sglang-1x4": _entry(4, 1, engine="sglang", **{TP: 4}),
    # TP x PP short of the GPUs: vec-inf would refuse it after the download.
    "Short-1x4": _entry(4, 1, **{TP: 2}),
}


@pytest.fixture
def api(monkeypatch, tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, body in (("sbatch", FAKE_SBATCH), ("sinfo", FAKE_SINFO)):
        (bin_dir / name).write_text(body)
        (bin_dir / name).chmod(0o755)
    capture = tmp_path / "capture"
    capture.mkdir()
    catalog = tmp_path / "models.yaml"
    catalog.write_text(yaml.safe_dump({"models": CATALOG}))
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("CAPTURE_DIR", str(capture))
    monkeypatch.setenv("FAKE_SINFO_OUT", SINFO_DELTAAI)
    monkeypatch.setenv("VEC_INF_MODEL_CONFIG", str(catalog))
    monkeypatch.setenv("VEC_INF_WORK_DIR", str(tmp_path))
    monkeypatch.setenv("VEC_INF_ACCOUNT", "test-account")
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setattr(settings, "VEC_INF_ENV", FIXTURE_VEC_INF_ENV)
    monkeypatch.setattr(settings, "VEC_INF_EXECUTION_MODE", VecInfExecutionMode.DIRECT)

    # One connection for every thread: TestClient runs the route in a worker.
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    AvailableModel.__table__.create(engine)
    ModelDeployment.__table__.create(engine)
    db = sessionmaker(bind=engine)()
    for name in CATALOG:
        db.add(
            AvailableModel(
                id=name,
                name=name,
                type="small",
                family="test",
                variant="",
                modelType="LLM",
                specs={},
                huggingfaceId=f"test/{name}",
            )
        )
    db.commit()

    downloads = []
    monkeypatch.setattr(
        "app.services.model_service.start_public_model_download",
        lambda repo_id: downloads.append(repo_id) or False,
    )
    monkeypatch.setattr(
        "app.services.model_service.check_model_hf_access",
        lambda *a, **k: (True, None),
    )

    class _Resources:
        def allocate_resources(self, **kwargs):
            return {"success": True}

        def release_resources(self, **kwargs):
            return {"success": True}

    monkeypatch.setattr(
        "app.services.model_service.ResourceService", lambda: _Resources()
    )
    monkeypatch.setattr(
        model_controller.model_service, "llm_client", llm_inference.LLMInferenceClient()
    )
    # Every vec-inf launcher, the adapter's MultinodeLauncher included.
    launchers = []
    real_init = _helper.ModelLauncher.__init__

    def spy_init(self, model_name, kwargs):
        launchers.append(model_name)
        real_init(self, model_name, kwargs)

    monkeypatch.setattr(_helper.ModelLauncher, "__init__", spy_init)

    app = FastAPI()
    app.include_router(model_controller.router, prefix="/api/models")

    def _db():
        yield db

    app.dependency_overrides[get_db] = _db

    class Api:
        def __init__(self):
            self.client = TestClient(app)
            self.db = db
            self.downloads = downloads
            self.launchers = launchers

        def launch(self, model, **shape):
            return self.client.post(
                "/api/models/deployments",
                json={"modelName": model, "modelId": model, "userId": USER_ID, **shape},
            )

        def scripts(self):
            return [p.read_text() for p in sorted(capture.iterdir())]

        def rows(self):
            return self.db.query(ModelDeployment).count()

    yield Api()
    db.close()


def assert_refused(api, response, reason):
    assert response.status_code == 422, response.text
    assert reason in response.json()["detail"]
    assert api.launchers == []
    assert api.scripts() == []
    assert api.downloads == []
    assert api.rows() == 0


def _flag(script, flag):
    """The value a flag has in the rendered vLLM command, or None."""
    for line in script.splitlines():
        words = line.split()
        if words[:1] == [flag]:
            return words[1]
        for word in words:
            if word.startswith(f"{flag}="):
                return word.split("=", 1)[1]
    return None


# The control: the harness sees a submission, so the refusals below can fail.
def test_a_runnable_two_node_request_is_submitted(api):
    response = api.launch("Plain-2x4", num_gpus=4, num_nodes=2)

    assert response.status_code == 201, response.text
    assert api.launchers and len(api.scripts()) == 1
    assert api.rows() == 1


# --- the five refusals ------------------------------------------------------


def test_refuses_more_nodes_than_the_partition_allows(api):
    response = api.launch("Plain-2x4", num_gpus=4, num_nodes=4)

    assert_refused(api, response, f"partition {PARTITION} allows at most 2")


def test_refuses_more_gpus_per_node_than_the_partition_has(api):
    response = api.launch("Plain-1x4", num_gpus=8)

    assert_refused(api, response, f"partition {PARTITION} has 4 per node")


def test_refuses_tensor_parallel_across_nodes(api):
    # Matches the entry's own layout, so its TP 8 over 2 nodes of 4 stands.
    response = api.launch("Wide-2x4", num_gpus=4, num_nodes=2)

    assert_refused(api, response, "tensor parallel 8 would span nodes of 4 GPUs")


def test_refuses_multinode_sglang(api):
    response = api.launch("Sglang-1x4", num_gpus=4, num_nodes=2)

    assert_refused(api, response, "multinode launches run on vLLM only")


def test_refuses_multinode_on_an_untested_vec_inf(api, monkeypatch):
    monkeypatch.setattr(vec_inf_multinode, "installed_vec_inf_version", lambda: "0.9.1")

    response = api.launch("Plain-2x4", num_gpus=4, num_nodes=2)

    assert_refused(api, response, "vec-inf 0.9.1 is not a version")


# --- shapes vec-inf would refuse only after the download ----------------------


def test_refuses_a_gpu_total_that_is_not_a_power_of_two(api):
    response = api.launch("Plain-1x4", num_gpus=3)

    assert_refused(api, response, "3 GPUs in all")


def test_refuses_counts_below_one(api):
    response = api.launch("Plain-1x4", num_gpus=4, num_nodes=0)

    assert_refused(api, response, "must each be at least 1")


def test_refuses_no_gpus(api):
    response = api.launch("Plain-1x4", num_gpus=0)

    assert_refused(api, response, "must each be at least 1")


def test_refuses_a_catalog_layout_that_does_not_use_the_gpus(api):
    response = api.launch("Short-1x4", num_gpus=4)

    assert_refused(api, response, "does not match the 4 GPUs requested")


# --- the partition, as Slurm answers ------------------------------------------


def test_refuses_a_partition_slurm_does_not_list(api):
    response = api.launch("Plain-1x4", num_gpus=4, partition="ghx4-interactiv")

    assert_refused(api, response, "partition ghx4-interactiv is not a partition")


def test_refuses_a_partition_list_that_names_none(api):
    response = api.launch("Plain-1x4", num_gpus=4, partition=",")

    assert_refused(api, response, "names no partition")


def test_a_partition_list_runs_where_every_partition_fits(api):
    response = api.launch(
        "Plain-2x4", num_gpus=4, num_nodes=2, partition="ghx4-interactive,ghx4"
    )

    assert response.status_code == 201, response.text
    assert len(api.scripts()) == 1


def test_refuses_a_partition_list_one_partition_cannot_run(api):
    # Slurm (EnforcePartLimits=ALL) rejects it at submit although ghx4 could run it.
    response = api.launch(
        "Plain-2x4", num_gpus=4, num_nodes=4, partition="ghx4-interactive,ghx4"
    )

    assert_refused(api, response, "partition ghx4-interactive allows at most 2")


def test_refuses_a_partition_list_with_an_unlisted_name(api):
    response = api.launch(
        "Plain-1x4", num_gpus=4, partition="ghx4-interactive,ghx4-interactiv"
    )

    assert_refused(api, response, "partition ghx4-interactiv is not a partition")


def test_refuses_fewer_nodes_than_the_partition_needs(api, monkeypatch):
    monkeypatch.setenv("FAKE_SINFO_OUT", "big|2-8|gpu:a100:4(S:0-3)\n")

    response = api.launch("Plain-1x4", num_gpus=4, partition="big")

    assert_refused(api, response, "partition big needs at least 2")


def test_a_refusal_names_every_limit_the_request_breaks(api, monkeypatch):
    monkeypatch.setenv(
        "FAKE_SINFO_OUT", "wide|1-8|gpu:a100:4(S:0-3)\nfat|1|gpu:a100:4(S:0-3)\n"
    )

    response = api.launch("Plain-1x4", num_gpus=8, num_nodes=8, partition="wide,fat")

    assert_refused(api, response, "partition fat allows at most 1")
    detail = response.json()["detail"]
    assert "partition wide has 4 per node, partition fat has 4 per node" in detail


def test_a_partition_list_needs_only_one_partition_with_the_gpus(api, monkeypatch):
    monkeypatch.setenv(
        "FAKE_SINFO_OUT", "a4|1-8|gpu:a100:4(S:0-3)\na8|1-8|gpu:a100:8(S:0-7)\n"
    )

    response = api.launch("Plain-1x4", num_gpus=8, partition="a4,a8")

    assert response.status_code == 201, response.text
    assert len(api.scripts()) == 1


def test_the_partition_checks_are_skipped_when_slurm_does_not_answer(
    api, monkeypatch, tmp_path
):
    """Slurm's own submit-time limits then apply; the launch is not blocked."""
    (tmp_path / "bin" / "sinfo").write_text("#!/bin/sh\nexit 1\n")

    response = api.launch("Plain-2x4", num_gpus=4, num_nodes=4)

    assert response.status_code == 201, response.text
    assert len(api.scripts()) == 1


# --- #112: whose TP/PP the launch runs with ---------------------------------


def test_a_request_matching_the_catalog_keeps_its_tp_and_pp(api):
    response = api.launch("Tuned-1x4", num_gpus=4, num_nodes=1)

    assert response.status_code == 201, response.text
    (script,) = api.scripts()
    assert (_flag(script, TP), _flag(script, PP)) == ("2", "2")


def test_a_request_unlike_the_catalog_gets_tp_per_node_and_pp_per_node_count(api):
    response = api.launch("Tuned-1x4", num_gpus=2)

    assert response.status_code == 201, response.text
    (script,) = api.scripts()
    assert (_flag(script, TP), _flag(script, PP)) == ("2", "1")


def test_a_two_node_request_on_a_one_node_entry_gets_pp_across_nodes(api):
    response = api.launch("Plain-1x4", num_gpus=4, num_nodes=2)

    assert response.status_code == 201, response.text
    (script,) = api.scripts()
    assert "llmhub-multinode-rank.sh" in script
    assert (_flag(script, TP), _flag(script, PP)) == ("4", "2")


def test_a_request_without_counts_is_not_checked(api, monkeypatch):
    """The UI's launch: the catalog's layout, as before, and no Slurm query."""
    monkeypatch.setenv("FAKE_SINFO_OUT", f"{PARTITION}|1|gpu:1\n")

    response = api.launch("Plain-2x4")

    assert response.status_code == 201, response.text
    (script,) = api.scripts()
    assert (_flag(script, TP), _flag(script, PP)) == ("4", "2")


# --- the partition's limits, as sinfo gives them ----------------------------


def test_partition_limits_parse_sinfo(monkeypatch):
    out = SINFO_DELTAAI + "mixed|1-4|gpu:a100:4(S:0-3)\nmixed|1-4|gpu:a100:8(S:0-7)\n"
    out += "cpu|1-2|(null)\nexact|2|gpu:a100:4(S:0-3)\n"
    out += "split|1-infinite|gpu:a100:4(S:0-3)\nsplit|2-4|gpu:a100:8(S:0-7)\n"
    monkeypatch.setattr(launch_layout, "_sinfo", lambda: out)

    assert launch_layout.partition_limits() == {
        "full": (1, None, 4),
        "test": (1, None, 4),
        "ghx4": (1, None, 4),
        "ghx4-interactive": (1, 2, 4),
        "mixed": (1, 4, 8),
        "cpu": (1, 2, None),
        "exact": (2, 2, 4),
        "split": (2, 4, 8),
    }


def test_partition_limits_are_unknown_when_sinfo_fails(monkeypatch, tmp_path):
    (tmp_path / "sinfo").write_text("#!/bin/sh\necho boom >&2\nexit 1\n")
    (tmp_path / "sinfo").chmod(0o755)
    monkeypatch.setenv("PATH", f"{tmp_path}{os.pathsep}{os.environ['PATH']}")

    assert launch_layout.partition_limits() is None
