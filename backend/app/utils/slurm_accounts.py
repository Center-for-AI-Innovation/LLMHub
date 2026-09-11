"""Resolve a cluster user's Slurm accounts via sacctmgr."""

import re
import subprocess
from typing import List, Optional

_ACCOUNT_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def is_valid_slurm_account_name(account: str) -> bool:
    """Return True when ``account`` looks like a Slurm account name."""
    return bool(_ACCOUNT_NAME_RE.fullmatch(account))


def _is_gpu_account(account: str) -> bool:
    lowered = account.lower()
    return lowered.endswith("-gpu") or "-gpu-" in lowered


def list_user_slurm_accounts(cluster_username: str) -> List[str]:
    """Return unique Slurm accounts for a validated cluster username.

    Uses ``sacctmgr -nP show associations user=<USER> format=Account``.
    Duplicate association rows (one per partition/cluster) are collapsed.
    The placeholder ``noalloc`` account is omitted.
    """
    command = [
        "sacctmgr",
        "-nP",
        "show",
        "associations",
        f"user={cluster_username}",
        "format=Account",
    ]
    try:
        result = subprocess.run(
            command,
            text=True,
            capture_output=True,
            check=False,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("Required command not found: sacctmgr") from exc

    if result.returncode != 0:
        stderr = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(
            f"Failed to resolve Slurm accounts for {cluster_username}: {stderr}"
        )

    accounts: List[str] = []
    seen = set()
    for raw_line in result.stdout.splitlines():
        account = raw_line.strip().strip("|").strip()
        if not account or account in seen:
            continue
        if account.lower() == "noalloc":
            continue
        if not is_valid_slurm_account_name(account):
            continue
        seen.add(account)
        accounts.append(account)

    return accounts


def pick_default_slurm_account(
    accounts: List[str], prefer_gpu: bool = True
) -> Optional[str]:
    """Pick a default account from an already-fetched list."""
    if not accounts:
        return None
    if prefer_gpu:
        for account in accounts:
            if _is_gpu_account(account):
                return account
    return accounts[0]


def select_user_slurm_account(cluster_username: str, prefer_gpu: bool = True) -> str:
    """Resolve a single Slurm account for a validated username."""
    accounts = list_user_slurm_accounts(cluster_username)
    selected = pick_default_slurm_account(accounts, prefer_gpu=prefer_gpu)
    if selected is None:
        raise RuntimeError(f"No Slurm accounts found for {cluster_username}")
    return selected
