"""Render every entry of one catalog with and without the multinode adapter.

Run by T2 in a fresh interpreter, because vec-inf reads its environment config
at import time: ``VEC_INF_CONFIG_DIR``, ``VEC_INF_MODEL_CONFIG`` and
``VEC_INF_ENV`` must be set before anything imports it.

    python multinode_render.py <work_dir> <out.json>

Both sides go through ``LLMInferenceDirectClient.launch_model`` and vec-inf's
real launch against a fake sbatch. "Without" replaces only the adapter's
dispatch with the call it replaced, ``client.launch_model``.
"""

import json
import os
import sys
import warnings
from pathlib import Path

import yaml

warnings.simplefilter("ignore")

from multinode_helpers import FAKE_SBATCH  # noqa: E402
from vec_inf.client._utils import load_config  # noqa: E402

from app.utils import llm_inference, vec_inf_multinode  # noqa: E402

work = Path(sys.argv[1])
out = Path(sys.argv[2])
bin_dir = work / "bin"
bin_dir.mkdir(parents=True)
(bin_dir / "sbatch").write_text(FAKE_SBATCH)
(bin_dir / "sbatch").chmod(0o755)
os.environ["PATH"] = f"{bin_dir}{os.pathsep}{os.environ['PATH']}"

adapter = vec_inf_multinode.launch_model


def stock(client, model_name, options):
    return client.launch_model(model_name, options=options)


def render(model_name, side, dispatch):
    capture = work / "capture" / side / model_name
    capture.mkdir(parents=True)
    os.environ["CAPTURE_DIR"] = str(capture)
    vec_inf_multinode.launch_model = dispatch
    try:
        result = llm_inference.LLMInferenceDirectClient().launch_model(
            model_name,
            deployment_api_key="k",
            model_weights_parent_dir=str(work / "weights"),
            log_dir=str(work / "logs"),
            work_dir=str(work),
            account="test-account",
        )
    finally:
        vec_inf_multinode.launch_model = adapter
    scripts = sorted(capture.iterdir())
    if not result["success"]:
        return {"error": result["error"], "submitted": len(scripts)}
    assert len(scripts) == 1, scripts
    return {"script": scripts[0].read_text()}


catalog_path = os.environ.get("VEC_INF_MODEL_CONFIG") or str(
    Path(os.environ["VEC_INF_CONFIG_DIR"], "models.yaml")
)
catalog = yaml.safe_load(Path(catalog_path).read_text())
# vec-inf merges the catalog over a base one (its packaged catalog, unless the
# environment names another), so an entry's node count and engine are what that
# merge resolves, not what the catalog file says.
resolved = {c.model_name: c for c in load_config()}
rows = {}
for name in catalog["models"]:
    rows[name] = {
        "num_nodes": int(resolved[name].num_nodes),
        "engine": resolved[name].engine or "vllm",
        "with": render(name, "with", adapter),
        "without": render(name, "without", stock),
    }
out.write_text(json.dumps(rows))
