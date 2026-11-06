#!/usr/bin/env python3
"""Render one cluster's vec-inf catalog: the backend's models.yaml plus an override.

    render-models.py <base models.yaml> <override.yaml or ""> <out models.yaml>

Called by ``llmhub``'s render_vec_inf_config, and by the backend tests that
check what each cluster renders. With no override the base is written as is.

Override format:
    remove: [name, ...]   left out of the rendered catalog. LLMHub lists, and
                          launches, only what this file names.
    models:
      <name>: {...}       merged over the base entry one top-level key at a
                          time, so a given ``vllm_args`` replaces the base's whole
                          and a 2-node layout's --pipeline-parallel-size cannot
                          survive into a 1-node one. A name the base lacks is
                          added as given.

A ``remove`` name the base lacks is an error: a typo must not leave an entry
in the catalog that the override meant to take out.
"""

import sys

import yaml


def render(base: dict, override: dict) -> dict:
    models = dict(base.get("models") or {})
    remove = override.get("remove") or []
    missing = [name for name in remove if name not in models]
    if missing:
        raise SystemExit(f"render-models: cannot remove {missing}: not in the base catalog")
    for name in remove:
        del models[name]
    for name, entry in (override.get("models") or {}).items():
        merged = dict(models.get(name) or {})
        merged.update(entry)
        models[name] = merged
    return {**base, "models": models}


def main(argv):
    base_path, override_path, out_path = argv[1:4]
    with open(base_path) as f:
        base = yaml.safe_load(f) or {}
    override = {}
    if override_path:
        with open(override_path) as f:
            override = yaml.safe_load(f) or {}
    with open(out_path, "w") as f:
        yaml.safe_dump(render(base, override), f, sort_keys=False)


if __name__ == "__main__":
    main(sys.argv)
