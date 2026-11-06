"""T2: single-node launches are untouched by the multinode adapter.

For each cluster, every entry of the catalog the kit renders there is launched
twice through LLMHub's real call site: with the adapter, and with the adapter's
dispatch replaced by the call it replaced (vec-inf 0.9.0 plus LLMHub's #83 env
patch). Every 1-node entry must submit the same script both ways, and every
multinode vLLM entry must not.

Each cluster renders in its own interpreter, with the catalog the kit renders
there (``infra/delta/render-models.py``), that cluster's job env and pre-command
as the kit sources them, and an environment.yaml built from the kit's template
(``config/infrastructures/delta/environment.yaml``). Those values shape both
sides alike; what the test compares is the dispatch.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
import yaml
from multinode_helpers import kit_config, render_catalog

BACKEND = Path(__file__).resolve().parents[1]
ENV_TEMPLATE = BACKEND / "config" / "infrastructures" / "delta" / "environment.yaml"
CLUSTERS = ["delta", "deltaai"]


def _cluster_environment(cluster, kit):
    env = yaml.safe_load(ENV_TEMPLATE.read_text())
    if kit["LLMHUB_CONTAINER_LOAD_CMD"]:
        env["containerization"]["module_load_cmd"] = kit["LLMHUB_CONTAINER_LOAD_CMD"]
    if cluster == "deltaai":
        env["paths"][
            "vllm_image_path"
        ] = "/sw/llmhub/vllm-v0.28.0-slingshot-deltaai.sif"
        env["default_args"].update(
            account="bfmz-dtai-gh",
            partition="ghx4-interactive",
            resource_type="nvidia_gh200_120gb",
        )
    else:
        env["paths"]["vllm_image_path"] = "/sw/llmhub/vllm-v0.19.1-slingshot-v3.sif"
    return env


@pytest.fixture(scope="module", params=CLUSTERS)
def rendered(request, tmp_path_factory):
    cluster = request.param
    kit = kit_config(cluster)
    work = tmp_path_factory.mktemp(cluster)
    config_dir = work / "vec-inf-config"
    config_dir.mkdir()
    (config_dir / "environment.yaml").write_text(
        yaml.safe_dump(_cluster_environment(cluster, kit))
    )
    catalog = render_catalog(cluster, work / "models.yaml")
    out = work / "rendered.json"
    env = {
        **os.environ,
        "VEC_INF_CONFIG_DIR": str(config_dir),
        "VEC_INF_MODEL_CONFIG": str(catalog),
        "VEC_INF_ENV": kit["LLMHUB_VEC_INF_ENV"],
        "PYTHONPATH": str(BACKEND),
    }
    subprocess.run(
        [
            sys.executable,
            str(Path(__file__).with_name("multinode_render.py")),
            str(work / "run"),
            str(out),
        ],
        env=env,
        check=True,
        cwd=BACKEND,
        timeout=600,
    )
    return cluster, json.loads(out.read_text())


def test_every_single_node_entry_renders_the_same_script(rendered):
    cluster, rows = rendered
    single = {n: r for n, r in rows.items() if r["num_nodes"] == 1}

    differ = [n for n, r in single.items() if r["with"] != r["without"]]
    submitted = [n for n, r in single.items() if "script" in r["without"]]
    print(
        f"T2 {cluster}: {len(single)} 1-node entries compared, "
        f"{len(submitted)} submitted a script both ways, {len(differ)} differ"
    )
    assert len(submitted) > 0, "nothing was compared"
    assert differ == []
    for name in submitted:
        assert "llmhub-multinode" not in single[name]["with"]["script"], name


def test_every_multinode_vllm_entry_renders_the_adapter(rendered):
    cluster, rows = rendered
    multi = {
        n: r for n, r in rows.items() if r["num_nodes"] > 1 and r["engine"] == "vllm"
    }

    same = [n for n, r in multi.items() if r["with"] == r["without"]]
    print(
        f"T2 {cluster}: {len(multi)} multinode vLLM entries compared, {len(same)} same"
    )
    assert len(multi) > 0, "nothing was compared"
    assert same == []
    for name, row in multi.items():
        assert "script" in row["with"], (name, row["with"])
        assert "llmhub-multinode-rank.sh" in row["with"]["script"], name
        assert "ray start" in row["without"]["script"], name
