"""The deploy kit's multinode config (LLMHub #174), as each cluster renders it.

Reads ``infra/delta/config`` the way ``llmhub`` does (dev profile) and renders
each cluster's catalog with the kit's own ``render-models.py``.
"""

import json
import os
import subprocess
import sys

import pytest
import yaml
from multinode_helpers import (
    BACKEND_CATALOG,
    ENV_TEMPLATE,
    KIT,
    kit_config,
    render_catalog,
    render_vec_inf_config,
)
from vec_inf.client._utils import load_config

PAIR = ("FI_CXI_RDZV_THRESHOLD=8192", "FI_CXI_RDZV_GET_MIN=0")
ONE_NODE_ON_GH200 = [
    "c4ai-command-r-plus-08-2024",
    "Mistral-Large-Instruct-2407",
    "Mistral-Large-Instruct-2411",
    "Mixtral-8x22B-v0.1",
    "Mixtral-8x22B-Instruct-v0.1",
]
LEFT_OUT = [
    "Llama-3.2-90B-Vision",
    "Llama-3.2-90B-Vision-Instruct",
    "Meta-Llama-3.1-405B-Instruct",
]
QWEN3_235B = "Qwen3-235B-A22B-Instruct-2507"


@pytest.mark.parametrize("cluster", ["delta", "deltaai"])
def test_job_env_carries_the_gap098_pair(cluster):
    fields = kit_config(cluster)["LLMHUB_VEC_INF_ENV"].split(",")
    for pair in PAIR:
        assert pair in fields, (cluster, fields)


def test_deltaai_slurm_network_is_the_site_value():
    load_cmd = kit_config("deltaai")["LLMHUB_CONTAINER_LOAD_CMD"]
    assert load_cmd.startswith("export SLURM_NETWORK=disable_rdzv_get;"), load_cmd
    # Single-node jobs still switch the OFI plugin off.
    assert (
        '[ "${SLURM_JOB_NUM_NODES:-1}" -gt 1 ] || export APPTAINERENV_NCCL_NET_PLUGIN=none'
        in load_cmd
    )


def test_delta_renders_the_backend_catalog_unchanged(tmp_path):
    assert kit_config("delta")["LLMHUB_MODELS_OVERRIDE"] == ""
    rendered = render_catalog("delta", tmp_path / "models.yaml")
    assert yaml.safe_load(rendered.read_text()) == yaml.safe_load(
        BACKEND_CATALOG.read_text()
    )


@pytest.fixture
def deltaai_catalog(tmp_path):
    path = render_catalog("deltaai", tmp_path / "models.yaml")
    return path, yaml.safe_load(path.read_text())["models"]


def test_deltaai_runs_five_entries_on_one_node(deltaai_catalog):
    _, models = deltaai_catalog
    base = yaml.safe_load(BACKEND_CATALOG.read_text())["models"]
    for name in ONE_NODE_ON_GH200:
        assert base[name]["num_nodes"] == 2, name
        entry = models[name]
        assert (entry["num_nodes"], entry["gpus_per_node"]) == (1, 4), name
        assert entry["vllm_args"]["--tensor-parallel-size"] == 4, name
        assert "--pipeline-parallel-size" not in entry["vllm_args"], name
        # Everything else is the base entry's.
        assert entry["hf_model"] == base[name]["hf_model"], name
        assert (
            entry["vllm_args"]["--max-model-len"]
            == base[name]["vllm_args"]["--max-model-len"]
        )


def test_deltaai_leaves_out_mllama_and_405b(deltaai_catalog):
    _, models = deltaai_catalog
    assert [name for name in LEFT_OUT if name in models] == []


def test_deltaai_adds_qwen3_235b_on_two_nodes(deltaai_catalog):
    _, models = deltaai_catalog
    entry = models[QWEN3_235B]
    assert entry["hf_model"] == "Qwen/Qwen3-235B-A22B-Instruct-2507"
    assert (entry["num_nodes"], entry["gpus_per_node"]) == (2, 4)
    assert entry["vllm_args"]["--tensor-parallel-size"] == 4
    assert entry["vllm_args"]["--pipeline-parallel-size"] == 2


def test_deltaai_changes_nothing_else(deltaai_catalog):
    _, models = deltaai_catalog
    base = yaml.safe_load(BACKEND_CATALOG.read_text())["models"]
    untouched = set(base) - set(ONE_NODE_ON_GH200) - set(LEFT_OUT)
    assert len(untouched) > 0
    assert {n: models[n] for n in untouched} == {n: base[n] for n in untouched}
    assert set(models) == untouched | set(ONE_NODE_ON_GH200) | {QWEN3_235B}


def test_vec_inf_loads_the_deltaai_catalog(deltaai_catalog):
    path, models = deltaai_catalog
    configs = {c.model_name: c for c in load_config(str(path))}
    print(f"load_config({path.name}): {len(configs)} entries")

    assert set(configs) == set(models)
    for name in ONE_NODE_ON_GH200:
        assert configs[name].num_nodes == 1, name
    assert configs[QWEN3_235B].num_nodes == 2
    assert configs[QWEN3_235B].vllm_args["--pipeline-parallel-size"] == 2
    assert configs[QWEN3_235B].mem_per_node == "400G"


_LAUNCH_PATH_CATALOG = """
import json
from vec_inf.client._utils import load_config
print(json.dumps({c.model_name: [c.num_nodes, c.engine] for c in load_config()}))
"""


def _launch_path_catalog(vic):
    """What vec-inf resolves at launch: load_config() with no path, as
    ModelLauncher calls it, in an interpreter that read the rendered config."""
    env = {**os.environ, "VEC_INF_CONFIG_DIR": str(vic)}
    env.pop("VEC_INF_MODEL_CONFIG", None)
    out = subprocess.run(
        [sys.executable, "-c", _LAUNCH_PATH_CATALOG],
        env=env,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return json.loads(out.splitlines()[-1])


def test_deltaai_launch_path_sees_only_the_rendered_catalog(tmp_path):
    vic = render_vec_inf_config("deltaai", tmp_path / "vic", tmp_path / "logs")
    rendered = yaml.safe_load((vic / "models.yaml").read_text())["models"]

    resolved = _launch_path_catalog(vic)
    print(f"deltaai launch path: {len(resolved)} models, rendered {len(rendered)}")

    assert set(resolved) == set(rendered)
    assert [name for name in LEFT_OUT if name in resolved] == []
    assert resolved[QWEN3_235B] == [2, "vllm"]
    for name in ONE_NODE_ON_GH200:
        assert resolved[name][0] == 1, name


def test_delta_keeps_vec_inf_s_base_catalog(tmp_path):
    vic = render_vec_inf_config("delta", tmp_path / "vic", tmp_path / "logs")
    template = yaml.safe_load(ENV_TEMPLATE.read_text())
    env = yaml.safe_load((vic / "environment.yaml").read_text())

    assert (
        env["paths"]["cached_model_config_path"]
        == template["paths"]["cached_model_config_path"]
    )
    assert (
        "containerization" not in env
        or env["containerization"].get("module_load_cmd")
        == template["containerization"]["module_load_cmd"]
    )


def _render_with(tmp_path, override):
    path = tmp_path / "override.yaml"
    path.write_text(yaml.safe_dump(override))
    return subprocess.run(
        [
            sys.executable,
            str(KIT / "render-models.py"),
            str(BACKEND_CATALOG),
            str(path),
            str(tmp_path / "o.yaml"),
        ],
        capture_output=True,
        text=True,
    )


@pytest.mark.parametrize(
    "override, message",
    [
        ({"remove": ["Llama-3.2-90B-Vison"]}, "cannot remove"),
        (
            {"models": {"Mistral-Large-Instruct-2047": {"num_nodes": 1}}},
            "cannot change",
        ),
        ({"add": {"Qwen3-32B": {"num_nodes": 1}}}, "cannot add"),
    ],
)
def test_a_name_typo_in_the_override_is_an_error(tmp_path, override, message):
    proc = _render_with(tmp_path, override)

    assert proc.returncode != 0
    assert message in proc.stderr
