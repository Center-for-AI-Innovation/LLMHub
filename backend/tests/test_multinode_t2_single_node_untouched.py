"""T2: single-node launches are untouched by the multinode adapter.

For each cluster, every entry of the catalog the kit renders there is launched
twice through LLMHub's real call site: with the adapter, and with the adapter's
dispatch replaced by the call it replaced (vec-inf 0.9.0 plus LLMHub's #83 env
patch). Every 1-node entry must submit the same script both ways, and every
multinode vLLM entry must not.

Each cluster renders in its own interpreter, with an environment.yaml built from
the kit's template (``config/infrastructures/delta/environment.yaml``) and that
cluster's job pre-command and image (``infra/delta/config/``). Those values
shape both sides alike; what the test compares is the dispatch.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

BACKEND = Path(__file__).resolve().parents[1]
KIT_CONFIG = BACKEND.parent / "infra" / "delta" / "config"
ENV_TEMPLATE = BACKEND / "config" / "infrastructures" / "delta" / "environment.yaml"

# The catalog the kit renders on each cluster (`render_vec_inf_config`).
CATALOGS = {
    "deltaai": BACKEND / "config" / "models.yaml",
    "delta": BACKEND / "config" / "models.yaml",
}

# The deployment env, as delta.env renders LLMHUB_VEC_INF_ENV.
DEPLOYMENT_ENV = (
    "HF_HUB_CACHE=/projects/modelcache/public/huggingface,HF_HUB_OFFLINE=1,"
    "TRANSFORMERS_OFFLINE=1,TORCHINDUCTOR_CACHE_DIR=/root/.cache/torch_inductor,"
    "FI_LOG_PROV=none"
)


def _deltaai_load_cmd():
    text = (KIT_CONFIG / "cluster-deltaai.env").read_text()
    match = re.search(r"^LLMHUB_CONTAINER_LOAD_CMD='(.*)'$", text, re.M)
    assert match, "cluster-deltaai.env no longer sets LLMHUB_CONTAINER_LOAD_CMD"
    return match.group(1)


def _cluster_environment(cluster):
    env = yaml.safe_load(ENV_TEMPLATE.read_text())
    if cluster == "deltaai":
        env["paths"][
            "vllm_image_path"
        ] = "/sw/llmhub/vllm-v0.28.0-slingshot-deltaai.sif"
        env["containerization"]["module_load_cmd"] = _deltaai_load_cmd()
        env["default_args"].update(
            account="bfmz-dtai-gh",
            partition="ghx4-interactive",
            resource_type="nvidia_gh200_120gb",
        )
    else:
        env["paths"]["vllm_image_path"] = "/sw/llmhub/vllm-v0.19.1-slingshot-v3.sif"
    return env


@pytest.fixture(scope="module", params=sorted(CATALOGS))
def rendered(request, tmp_path_factory):
    cluster = request.param
    work = tmp_path_factory.mktemp(cluster)
    config_dir = work / "vec-inf-config"
    config_dir.mkdir()
    (config_dir / "environment.yaml").write_text(
        yaml.safe_dump(_cluster_environment(cluster))
    )
    out = work / "rendered.json"
    env = {
        **os.environ,
        "VEC_INF_CONFIG_DIR": str(config_dir),
        "VEC_INF_MODEL_CONFIG": str(CATALOGS[cluster]),
        "VEC_INF_ENV": DEPLOYMENT_ENV,
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
