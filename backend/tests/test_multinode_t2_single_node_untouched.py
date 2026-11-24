"""T2: single-node launches are untouched by the multinode adapter.

For each cluster, every entry of the catalog the kit renders there is launched
twice through LLMHub's real call site: with the adapter, and with the adapter's
dispatch replaced by the call it replaced (vec-inf 0.9.0 plus LLMHub's #83 env
patch). Every 1-node entry must submit the same script both ways, and every
multinode vLLM entry must not.

Each cluster renders in its own interpreter, with the vec-inf-config the kit
renders there (``infra/delta/render-vec-inf-env.py`` and ``render-models.py``)
and that cluster's job env, as the kit sources them. Those values shape both
sides alike; what the test compares is the dispatch.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from multinode_helpers import kit_config, render_vec_inf_config

BACKEND = Path(__file__).resolve().parents[1]
CLUSTERS = ["delta", "deltaai"]


@pytest.fixture(scope="module", params=CLUSTERS)
def rendered(request, tmp_path_factory):
    cluster = request.param
    kit = kit_config(cluster)
    work = tmp_path_factory.mktemp(cluster)
    config_dir = render_vec_inf_config(cluster, work / "vec-inf-config", work / "logs")
    out = work / "rendered.json"
    env = {
        **os.environ,
        # As the backend runs on the stack: the rendered directory, no override.
        "VEC_INF_CONFIG_DIR": str(config_dir),
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
