"""Shared fixtures for the multinode adapter's contract tests (T1-T5).

Every launch here goes through LLMHub's real call site and vec-inf's real
launch, against a fake ``sbatch`` that records the script it was handed.
"""

import os
import re
import subprocess
import sys
from pathlib import Path

import yaml

from app.config.config import settings
from app.utils import llm_inference

FAKE_SBATCH = """#!/bin/sh
n=$(ls "$CAPTURE_DIR" | wc -l)
cp "$1" "$CAPTURE_DIR/script.$n"
echo "Submitted batch job $((4242 + n))"
"""

# The deployment env as the kit renders it, plus the GAP-098 pair: what every
# rank's container must receive.
FIXTURE_VEC_INF_ENV = (
    "HF_HUB_CACHE=/projects/modelcache/public/huggingface,HF_HUB_OFFLINE=1,"
    "TRANSFORMERS_OFFLINE=1,FI_LOG_PROV=none,"
    "FI_CXI_RDZV_THRESHOLD=8192,FI_CXI_RDZV_GET_MIN=0"
)

TWO_NODE_MODEL = "Qwen2.5-7B-Instruct-2node"
ONE_NODE_MODEL = "Qwen2.5-7B-Instruct"

FIXTURE_CATALOG = {
    "models": {
        ONE_NODE_MODEL: {
            "model_family": "Qwen2.5",
            "model_variant": "7B-Instruct",
            "model_type": "LLM",
            "hf_model": "Qwen/Qwen2.5-7B-Instruct",
            "gpus_per_node": 4,
            "num_nodes": 1,
            "vocab_size": 152064,
            "vllm_args": {"--tensor-parallel-size": 4, "--max-model-len": 32768},
        },
        TWO_NODE_MODEL: {
            "model_family": "Qwen2.5",
            "model_variant": "7B-Instruct",
            "model_type": "LLM",
            "hf_model": "Qwen/Qwen2.5-7B-Instruct",
            "gpus_per_node": 4,
            "num_nodes": 2,
            "vocab_size": 152064,
            "vllm_args": {
                "--tensor-parallel-size": 4,
                "--pipeline-parallel-size": 2,
                "--max-model-len": 32768,
                # vec-inf forces Ray here; the adapter must drop it.
                "--distributed-executor-backend": "ray",
                "--enforce-eager": True,
            },
        },
    }
}

RANK_SCRIPT_RE = re.compile(
    r"cat > \"\$rank_script\" <<'(?P<tag>\w+)'\n(?P<body>.*?)\n(?P=tag)\n", re.S
)


class Launcher:
    """Launches through ``LLMInferenceDirectClient`` with a fake sbatch."""

    def __init__(self, monkeypatch, tmp_path: Path, vec_inf_env=FIXTURE_VEC_INF_ENV):
        bin_dir = tmp_path / "bin"
        bin_dir.mkdir(parents=True)
        sbatch = bin_dir / "sbatch"
        sbatch.write_text(FAKE_SBATCH)
        sbatch.chmod(0o755)
        self.capture = tmp_path / "capture"
        self.capture.mkdir()
        catalog = tmp_path / "models.yaml"
        catalog.write_text(yaml.safe_dump(FIXTURE_CATALOG))
        self.tmp_path = tmp_path
        self.log_dir = tmp_path / "logs"
        monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
        monkeypatch.setenv("CAPTURE_DIR", str(self.capture))
        monkeypatch.setenv("VEC_INF_MODEL_CONFIG", str(catalog))
        monkeypatch.setattr(settings, "VEC_INF_ENV", vec_inf_env)

    def launch(self, model_name: str, **params):
        params.setdefault("model_weights_parent_dir", str(self.tmp_path / "weights"))
        params.setdefault("log_dir", str(self.log_dir))
        params.setdefault("work_dir", str(self.tmp_path))
        params.setdefault("account", "test-account")
        return llm_inference.LLMInferenceDirectClient().launch_model(
            model_name, deployment_api_key="k", **params
        )

    def scripts(self):
        return [p.read_text() for p in sorted(self.capture.iterdir())]


def rank_script_of(batch_script: str) -> str:
    match = RANK_SCRIPT_RE.search(batch_script)
    assert match, "no rank-script heredoc in the batch script"
    return match.group("body") + "\n"


def batch_body_without_rank_script(batch_script: str) -> str:
    return RANK_SCRIPT_RE.sub("", batch_script)


KIT = Path(__file__).resolve().parents[2] / "infra" / "delta"
BACKEND_CATALOG = Path(__file__).resolve().parents[1] / "config" / "models.yaml"


def kit_config(cluster: str) -> dict:
    """The kit's values for one cluster, as ``llmhub`` sources them (dev profile)."""
    names = [
        "LLMHUB_VEC_INF_ENV",
        "LLMHUB_CONTAINER_LOAD_CMD",
        "LLMHUB_MODELS_OVERRIDE",
        "LLMHUB_VLLM_SIF",
        "LLMHUB_SLURM_ACCOUNT",
        "LLMHUB_LAUNCH_PARTITION",
        "LLMHUB_LAUNCH_RESOURCE_TYPE",
        "LLMHUB_LAUNCH_TIME",
        "LLMHUB_MODEL_WEIGHTS_PARENT_DIR",
        "LLMHUB_HF_CACHE",
    ]
    script = (
        f'LLMHUB_CLUSTER={cluster} LLMHUB_PROFILE=dev; . "{KIT}/config/delta.env" >/dev/null 2>&1; '
        + "; ".join(f'printf "%s\\0" "${n}"' for n in names)
    )
    out = subprocess.run(
        ["bash", "-c", script],
        env={
            "HOME": os.environ.get("HOME", "/tmp"),
            "PATH": os.environ["PATH"],
            "USER": "ci",
        },
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return dict(zip(names, out.split("\0")))


def render_catalog(cluster: str, out: Path) -> Path:
    """The models.yaml the kit renders on ``cluster`` (render_vec_inf_config)."""
    subprocess.run(
        [
            sys.executable,
            str(KIT / "render-models.py"),
            str(BACKEND_CATALOG),
            kit_config(cluster)["LLMHUB_MODELS_OVERRIDE"],
            str(out),
        ],
        check=True,
    )
    return out


ENV_TEMPLATE = (
    Path(__file__).resolve().parents[1]
    / "config"
    / "infrastructures"
    / "delta"
    / "environment.yaml"
)


def render_vec_inf_config(cluster: str, vic: Path, log_dir: Path) -> Path:
    """The vec-inf-config directory the kit renders on ``cluster``, under ``vic``.

    Both files come from the kit's own renderers, with the cluster's values as
    ``llmhub`` sources them; only the per-deployment paths (log dir, torch
    cache) are this test's.
    """
    kit = kit_config(cluster)
    vic.mkdir(parents=True, exist_ok=True)
    render_catalog(cluster, vic / "models.yaml")
    env = {
        **os.environ,
        **kit,
        "LLMHUB_VLLM_SIF_EFFECTIVE": kit["LLMHUB_VLLM_SIF"],
        "LLMHUB_VEC_INF_LOG_DIR": str(log_dir),
        "LLMHUB_TORCH_CACHE": str(vic / "torch-inductor"),
        "LLMHUB_MODELS_YAML": str(vic / "models.yaml"),
    }
    subprocess.run(
        [
            sys.executable,
            str(KIT / "render-vec-inf-env.py"),
            str(ENV_TEMPLATE),
            str(vic / "environment.yaml"),
        ],
        env=env,
        check=True,
    )
    return vic
