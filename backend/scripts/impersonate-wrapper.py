#!/usr/bin/env python3

import errno
import os
import pty
import re
import subprocess
import sys
from typing import Optional

ENV_PREFIXES_TO_PRESERVE = (
    "VEC_INF_",
    "HF_",
    "TRANSFORMERS_",
)
ENV_NAMES_TO_PRESERVE = {
    "INFRASTRUCTURE",
    "MODEL_CONFIG_PATH",
    "PYTHONPATH",
    "SLURM_ACCOUNT",
}
CLUSTER_USERNAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9._-]{0,63}$")


def _build_preserve_env_arg() -> Optional[str]:
    env_names = sorted(
        key
        for key in os.environ
        if key in ENV_NAMES_TO_PRESERVE or key.startswith(ENV_PREFIXES_TO_PRESERVE)
    )
    if not env_names:
        return None
    return f"--preserve-env={','.join(env_names)}"


def _run_with_pty(command: list[str]) -> subprocess.CompletedProcess[str]:
    """Run a command under a PTY so sudo works on requiretty hosts."""
    pid, master_fd = pty.fork()
    output_chunks: list[bytes] = []

    if pid == 0:
        os.execvpe(command[0], command, os.environ.copy())

    try:
        while True:
            try:
                chunk = os.read(master_fd, 4096)
            except OSError as exc:
                if exc.errno == errno.EIO:
                    break
                raise
            if not chunk:
                break
            output_chunks.append(chunk)
    finally:
        os.close(master_fd)

    _, status = os.waitpid(pid, 0)
    return subprocess.CompletedProcess(
        args=command,
        returncode=os.waitstatus_to_exitcode(status),
        stdout=b"".join(output_chunks).decode(errors="replace"),
        stderr="",
    )


def main() -> int:
    args = sys.argv[1:]
    use_login_shell = True
    allow_password_prompt = False

    while args and args[0].startswith("--"):
        if args[0] == "--no-login-shell":
            use_login_shell = False
            args = args[1:]
            continue
        if args[0] == "--allow-password-prompt":
            allow_password_prompt = True
            args = args[1:]
            continue
        break

    if len(args) < 3 or args[1] != "--":
        print(
            (
                f"Usage: {sys.argv[0]} "
                "[--no-login-shell] [--allow-password-prompt] <username> -- <command> [args...]"
            ),
            file=sys.stderr,
        )
        return 2

    username = args[0]
    if not CLUSTER_USERNAME_RE.fullmatch(username):
        print(f"Invalid cluster username: {username!r}", file=sys.stderr)
        return 2

    command = args[2:]

    sudo_command = ["sudo"]
    if not allow_password_prompt:
        sudo_command.append("-n")
    preserve_env_arg = _build_preserve_env_arg()
    if preserve_env_arg:
        sudo_command.append(preserve_env_arg)
    sudo_command.extend(["-u", username])
    if use_login_shell:
        sudo_command.append("-i")
    sudo_command.append("--")
    sudo_command.extend(command)

    if allow_password_prompt:
        result = subprocess.run(
            sudo_command,
            text=True,
            capture_output=True,
            env=os.environ.copy(),
        )
    else:
        result = _run_with_pty(sudo_command)

    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
