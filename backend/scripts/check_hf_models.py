#!/usr/bin/env python3
"""Verify every model in models.yaml resolves to a real Hugging Face repo.

For each model, resolves its effective ``hf_model`` (an explicit value, or
the ``model_family`` -> org fallback from ``app.utils.hf_family_orgs``) and
checks it against the real Hub via ``HfApi().repo_info()``. Catches typos,
renamed/deleted repos, or a model_family with no known org and no explicit
hf_model -- the same drift risk called out when the family fallback was
introduced.

Exit code is non-zero if any model fails to resolve or fails the Hub check,
so this can gate CI.

Usage: python backend/scripts/check_hf_models.py [path/to/models.yaml]
"""

import sys
from pathlib import Path
from typing import Optional

import yaml
from huggingface_hub import HfApi
from huggingface_hub.errors import HfHubHTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.utils.hf_family_orgs import resolve_hf_model  # noqa: E402

DEFAULT_MODELS_YAML = Path(__file__).resolve().parents[1] / "config" / "models.yaml"


def check_models(models_yaml_path: Path) -> int:
    with models_yaml_path.open() as f:
        data = yaml.safe_load(f) or {}

    models = data.get("models", {})
    if not models:
        print(f"::error::No models found in {models_yaml_path}")
        return 1

    api = HfApi()
    failures: list[tuple[str, Optional[str], str]] = []

    for model_name, cfg in models.items():
        model_family = cfg.get("model_family", "")
        explicit_hf_model = cfg.get("hf_model")
        hf_model = resolve_hf_model(model_family, model_name, explicit_hf_model)

        if not hf_model:
            failures.append(
                (
                    model_name,
                    None,
                    f"no hf_model set and model_family {model_family!r} has no "
                    "known org in FAMILY_TO_HF_ORG",
                )
            )
            continue

        try:
            api.repo_info(repo_id=hf_model, repo_type="model")
        except HfHubHTTPError as exc:
            failures.append((model_name, hf_model, f"HfHubHTTPError: {exc}"))
        except Exception as exc:  # noqa: BLE001 - report any lookup failure
            failures.append((model_name, hf_model, f"{type(exc).__name__}: {exc}"))

    total = len(models)
    ok = total - len(failures)
    print(f"Checked {total} models: {ok} ok, {len(failures)} failed.")

    if failures:
        print()
        for model_name, hf_model, reason in failures:
            target = hf_model or "(unresolved)"
            print(f"::error::{model_name}: hf_model={target} -- {reason}")
        return 1

    return 0


if __name__ == "__main__":
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_MODELS_YAML
    raise SystemExit(check_models(path))
