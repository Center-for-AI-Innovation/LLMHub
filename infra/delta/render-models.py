#!/usr/bin/env python3
"""Render one cluster's vec-inf catalog: the backend's models.yaml plus an override.

    render-models.py <base models.yaml> <override.yaml or ""> <out models.yaml>

Called by ``llmhub``'s render_vec_inf_config, and by the backend tests that
check what each cluster renders. With no override the base is written as is.

Override format:
    remove: [name, ...]   left out of the rendered catalog. With an override the
                          rendered file is also vec-inf's base catalog
                          (render-vec-inf-env.py), so a removed name is gone.
    models:
      <name>: {...}       merged over the base entry one top-level key at a
                          time, so a given ``vllm_args`` replaces the base's whole
                          and a 2-node layout's --pipeline-parallel-size cannot
                          survive into a 1-node one.
    add:
      <name>: {...}       a new, complete entry.

Every name is checked against the base: ``remove`` and ``models`` must name an
entry it has, and ``add`` one it lacks. A typo must neither leave in an entry
the override meant to change or take out, nor slip in a partial one.
"""

import sys

import yaml


def render(base: dict, override: dict) -> dict:
    models = dict(base.get("models") or {})
    remove = override.get("remove") or []
    change = override.get("models") or {}
    add = override.get("add") or {}
    for verb, names in (("remove", remove), ("change", change)):
        missing = [name for name in names if name not in models]
        if missing:
            raise SystemExit(f"render-models: cannot {verb} {missing}: not in the base catalog")
    present = [name for name in add if name in models]
    if present:
        raise SystemExit(f"render-models: cannot add {present}: already in the base catalog")
    for name in remove:
        del models[name]
    for name, entry in change.items():
        models[name] = {**models[name], **entry}
    models.update(add)
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
