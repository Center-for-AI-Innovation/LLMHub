#!/usr/bin/env python3
"""Render one cluster's vec-inf environment.yaml from the backend's template.

    render-vec-inf-env.py <template environment.yaml> <out environment.yaml>

Called by ``llmhub``'s render_vec_inf_config with the values below in its
environment, and by the backend tests that check what each cluster renders.
Every cluster-specific field is overwritten:

    LLMHUB_VLLM_SIF_EFFECTIVE                   paths.image_path, paths.vllm_image_path
    LLMHUB_SLURM_ACCOUNT, LLMHUB_LAUNCH_PARTITION, LLMHUB_LAUNCH_RESOURCE_TYPE,
    LLMHUB_LAUNCH_TIME, LLMHUB_VEC_INF_LOG_DIR, LLMHUB_MODEL_WEIGHTS_PARENT_DIR,
    LLMHUB_HF_CACHE, LLMHUB_TORCH_CACHE        default_args
    LLMHUB_CONTAINER_LOAD_CMD                   containerization.module_load_cmd, when set
    LLMHUB_MODELS_OVERRIDE + LLMHUB_MODELS_YAML paths.cached_model_config_path, when an
                                                override is set (below)

vec-inf merges the user catalog over a base one: cached_model_config_path if
that file exists, else vec-inf's own packaged catalog. A cluster with its own
catalog therefore names the rendered models.yaml as the base too, so what it
leaves out cannot come back from the packaged catalog at launch.
"""

import os
import sys

import yaml


def render(template: dict, e: dict) -> dict:
    d = dict(template)
    p = d.setdefault("paths", {})
    p["image_path"] = e["LLMHUB_VLLM_SIF_EFFECTIVE"]
    p["vllm_image_path"] = e["LLMHUB_VLLM_SIF_EFFECTIVE"]
    if e.get("LLMHUB_MODELS_OVERRIDE"):
        p["cached_model_config_path"] = e["LLMHUB_MODELS_YAML"]
    a = d.setdefault("default_args", {})
    a.update(
        account=e["LLMHUB_SLURM_ACCOUNT"],
        partition=e["LLMHUB_LAUNCH_PARTITION"],
        resource_type=e["LLMHUB_LAUNCH_RESOURCE_TYPE"],
        time=e["LLMHUB_LAUNCH_TIME"],
        log_dir=e["LLMHUB_VEC_INF_LOG_DIR"],
        model_weights_parent_dir=e["LLMHUB_MODEL_WEIGHTS_PARENT_DIR"],
        bind=f"{e['LLMHUB_HF_CACHE']}:{e['LLMHUB_HF_CACHE']}:ro,"
        f"{e['LLMHUB_TORCH_CACHE']}:/root/.cache/torch_inductor",
    )
    # Only when set, so a cluster that does not need it (Delta) renders exactly as before.
    if e.get("LLMHUB_CONTAINER_LOAD_CMD"):
        d.setdefault("containerization", {})["module_load_cmd"] = e["LLMHUB_CONTAINER_LOAD_CMD"]
    return d


def main(argv):
    src, dst = argv[1:3]
    with open(src) as f:
        template = yaml.safe_load(f) or {}
    with open(dst, "w") as f:
        yaml.safe_dump(render(template, os.environ), f, sort_keys=False)


if __name__ == "__main__":
    main(sys.argv)
