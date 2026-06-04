#!/usr/bin/env python3

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.config.config import settings
from app.utils.llm_inference import (
    _ensure_impersonated_workspace_dir,
    _get_impersonation_python,
    _select_user_slurm_account,
)


def _build_wrapper_env(account: str, workspace_dir: Path) -> dict[str, str]:
    env = os.environ.copy()
    pythonpath = env.get("PYTHONPATH")
    if pythonpath:
        env["PYTHONPATH"] = os.pathsep.join([str(PROJECT_ROOT), pythonpath])
    else:
        env["PYTHONPATH"] = str(PROJECT_ROOT)

    env["VEC_INF_ACCOUNT"] = account
    env["SLURM_ACCOUNT"] = account
    env["VEC_INF_WORK_DIR"] = str(workspace_dir)
    env["VEC_INF_LOG_DIR"] = str(workspace_dir)
    return env


def _run_wrapper_probe(cluster_username: str, account: str, workspace_dir: Path) -> dict:
    wrapper_path = Path(settings.VEC_INF_IMPERSONATE_SCRIPT)
    impersonation_python = _get_impersonation_python()
    probe = (
        "import json, os, pwd; "
        "from app.utils import vec_inf_launch_shim; "
        "print(json.dumps({"
        "\"whoami\": pwd.getpwuid(os.getuid()).pw_name, "
        "\"cwd\": os.getcwd(), "
        "\"python\": os.path.realpath(__import__(\"sys\").executable), "
        "\"shim\": os.path.realpath(vec_inf_launch_shim.__file__), "
        "\"vec_inf_account\": os.getenv(\"VEC_INF_ACCOUNT\"), "
        "\"slurm_account\": os.getenv(\"SLURM_ACCOUNT\"), "
        "\"vec_inf_work_dir\": os.getenv(\"VEC_INF_WORK_DIR\"), "
        "\"vec_inf_log_dir\": os.getenv(\"VEC_INF_LOG_DIR\")"
        "}))"
    )
    command = [
        str(wrapper_path),
        cluster_username,
        "--",
        impersonation_python,
        "-c",
        probe,
    ]
    result = subprocess.run(
        command,
        text=True,
        capture_output=True,
        env=_build_wrapper_env(account, workspace_dir),
        cwd=str(PROJECT_ROOT),
    )
    return {
        "command": command,
        "returncode": result.returncode,
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate LLMHub impersonation setup.")
    parser.add_argument("--user", required=True, help="Target cluster username to impersonate.")
    parser.add_argument(
        "--skip-wrapper",
        action="store_true",
        help="Skip the sudo/wrapper probe and only validate account/workspace setup.",
    )
    args = parser.parse_args()

    print(f"user={args.user}")
    print(f"execution_mode={settings.VEC_INF_EXECUTION_MODE}")
    print(f"shared_work_root={settings.VEC_INF_SHARED_WORK_ROOT}")
    print(f"wrapper={settings.VEC_INF_IMPERSONATE_SCRIPT}")
    print(f"impersonate_python={_get_impersonation_python()}")
    print(f"accounts_script={settings.VEC_INF_ACCOUNTS_SCRIPT}")

    account = _select_user_slurm_account(args.user)
    print(f"resolved_account={account}")

    workspace_dir = _ensure_impersonated_workspace_dir(args.user)
    if workspace_dir is None:
        print("workspace_dir=<none>")
    else:
        print(f"workspace_dir={workspace_dir}")

    if args.skip_wrapper:
        return 0

    if workspace_dir is None:
        print("wrapper_probe=skipped (no workspace dir)")
        return 1

    probe_result = _run_wrapper_probe(args.user, account, workspace_dir)
    print("wrapper_probe=" + json.dumps(probe_result, indent=2, sort_keys=True))
    return 0 if probe_result["returncode"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
