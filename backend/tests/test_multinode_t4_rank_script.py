"""T4: the rank script, executed with stubbed ``ip``, ``hostname`` and ``apptainer``.

The script is taken from a job rendered through LLMHub's real call site. Each
case runs it the way srun would on one node and reads what it would have
exec'd: rank -> flags, the master from ``hsn<digits>`` only, a refusal without
a fabric IPv4, and a barrier that gives up.
"""

import json
import os
import shlex
import subprocess
import textwrap

import pytest
from multinode_helpers import (
    FIXTURE_VEC_INF_ENV,
    TWO_NODE_MODEL,
    Launcher,
    rank_script_of,
)
from vec_inf.client._utils import is_server_running

# `ip -4 -o addr show` on a GH200 node, with a VLAN sub-interface ahead of the
# real ones (Delta's DNS answer) and a management NIC.
IP_HEAD = """\
1: lo    inet 127.0.0.1/8 scope host lo
2: hsn0.561    inet 172.28.9.1/16 brd 172.28.255.255 scope global hsn0.561
3: eth0    inet 141.142.1.5/24 brd 141.142.1.255 scope global eth0
4: hsn0    inet 10.150.0.11/16 brd 10.150.255.255 scope global hsn0
5: hsn1    inet 10.150.1.11/16 brd 10.150.255.255 scope global hsn1
6: hsn2    inet 10.150.2.11/16 brd 10.150.255.255 scope global hsn2
7: hsn3    inet 10.150.3.11/16 brd 10.150.255.255 scope global hsn3
"""
IP_WORKER = IP_HEAD.replace(".11/", ".12/").replace("172.28.9.1/", "172.28.9.2/")
IP_NO_FABRIC = """\
1: lo    inet 127.0.0.1/8 scope host lo
2: hsn0.561    inet 172.28.9.1/16 brd 172.28.255.255 scope global hsn0.561
3: eth0    inet 141.142.1.5/24 brd 141.142.1.255 scope global eth0
"""

# Records every apptainer call; prints a container env for the probe call.
APPTAINER_STUB = textwrap.dedent("""\
    #!/usr/bin/env python3
    import json, os, sys
    rec = {"argv": sys.argv[1:],
           "env": {k: v for k, v in os.environ.items()
                   if k.startswith(("APPTAINERENV_", "APPTAINER_BINDPATH"))}}
    with open(os.environ["STUB_LOG"], "a") as f:
        f.write(json.dumps(rec) + "\\n")
    if sys.argv[-1] == "env":
        print("FI_CXI_RDZV_THRESHOLD=8192")
    """)


@pytest.fixture(scope="module")
def rank_script(tmp_path_factory):
    tmp_path = tmp_path_factory.mktemp("render")
    with pytest.MonkeyPatch.context() as monkeypatch:
        launcher = Launcher(monkeypatch, tmp_path)
        assert launcher.launch(TWO_NODE_MODEL)["success"]
        (script,) = launcher.scripts()
    path = tmp_path / "llmhub-multinode-rank.sh"
    path.write_text(rank_script_of(script))
    return path


class Node:
    """One node's view: stub tools on PATH, a shared rendezvous directory."""

    def __init__(self, tmp_path, name, ip_output, rendezvous):
        self.dir = tmp_path / name
        stubs = self.dir / "bin"
        stubs.mkdir(parents=True)
        (stubs / "ip").write_text(f"#!/bin/sh\ncat <<'EOF'\n{ip_output}EOF\n")
        (stubs / "hostname").write_text(f"#!/bin/sh\necho {name}\n")
        (stubs / "apptainer").write_text(APPTAINER_STUB)
        for stub in stubs.iterdir():
            stub.chmod(0o755)
        self.log = self.dir / "apptainer.jsonl"
        self.env = {
            "PATH": f"{stubs}{os.pathsep}{os.environ['PATH']}",
            "STUB_LOG": str(self.log),
            "LLMHUB_MN_JOB_DIR": str(tmp_path / "job"),
            "LLMHUB_MN_RENDEZVOUS": str(rendezvous),
            "LLMHUB_MN_NNODES": "2",
            "LLMHUB_MN_MASTER_ADDR": "10.150.0.11",
            "LLMHUB_MN_MASTER_PORT": "29500",
            "LLMHUB_MN_API_PORT": "8123",
            "LLMHUB_MN_SERVED_NAME": TWO_NODE_MODEL,
            "LLMHUB_MN_BARRIER_TIMEOUT": "5",
            "CUDA_VISIBLE_DEVICES": "0,1,2,3",
            "APPTAINERENV_VLLM_PORT": "9999",
            "APPTAINER_BINDPATH": "/dev,/tmp",
        }

    def run(self, script, *args, **env):
        return subprocess.run(
            ["bash", str(script), *args],
            env={**self.env, **env},
            capture_output=True,
            text=True,
            timeout=60,
        )

    def calls(self):
        if not self.log.exists():
            return []
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def vllm_call(self):
        calls = [c for c in self.calls() if "vllm" in c["argv"]]
        assert len(calls) == 1, self.calls()
        return calls[0]


def _flag(argv, name):
    return argv[argv.index(name) + 1]


def _two_ranks(rank_script, tmp_path):
    rendezvous = tmp_path / "rendezvous"
    head = Node(tmp_path, "gh101", IP_HEAD, rendezvous)
    worker = Node(tmp_path, "gh102", IP_WORKER, rendezvous)
    procs = [
        subprocess.Popen(
            ["bash", str(rank_script)],
            env={**node.env, "SLURM_PROCID": str(rank)},
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        for rank, node in enumerate((head, worker))
    ]
    outs = [p.communicate(timeout=60) for p in procs]
    for p, (out, err) in zip(procs, outs):
        assert p.returncode == 0, (out, err)
    return head, worker, outs


def test_rank_flags(rank_script, tmp_path):
    head, worker, outs = _two_ranks(rank_script, tmp_path)
    rank0, rank1 = head.vllm_call(), worker.vllm_call()

    for rank, call in ((0, rank0), (1, rank1)):
        argv = call["argv"]
        assert _flag(argv, "--node-rank") == str(rank)
        assert _flag(argv, "--nnodes") == "2"
        assert _flag(argv, "--master-addr") == "10.150.0.11"
        assert _flag(argv, "--master-port") == "29500"
        assert _flag(argv, "--distributed-executor-backend") == "mp"
        assert argv[argv.index("vllm") - 3 : argv.index("vllm")] == [
            "env",
            "-u",
            "FI_LOG_LEVEL",
        ]
    assert _flag(rank0["argv"], "--port") == "8123"
    assert _flag(rank0["argv"], "--host") == "0.0.0.0"
    assert _flag(rank0["argv"], "--served-model-name") == TWO_NODE_MODEL
    assert "--headless" not in rank0["argv"]
    assert rank1["argv"][-1] == "--headless"
    assert "--port" not in rank1["argv"]
    # Neither rank reports anything vec-inf's status poll would call fatal.
    for out, err in outs:
        assert "error:" not in (out + err).lower()


def test_each_rank_gets_its_own_fabric_identity(rank_script, tmp_path):
    head, worker, _ = _two_ranks(rank_script, tmp_path)

    for node, ip in ((head, "10.150.0.11"), (worker, "10.150.0.12")):
        env = node.vllm_call()["env"]
        assert env["APPTAINERENV_VLLM_HOST_IP"] == ip
        # Exact interface names, so NCCL never matches the hsn0.561 VLAN.
        assert env["APPTAINERENV_NCCL_SOCKET_IFNAME"] == "=hsn0,hsn1,hsn2,hsn3"
        assert env["APPTAINERENV_GLOO_SOCKET_IFNAME"] == "hsn0"
        assert "APPTAINERENV_VLLM_PORT" not in env


def test_deployment_env_and_devices_reach_every_rank(rank_script, tmp_path):
    head, worker, _ = _two_ranks(rank_script, tmp_path)

    for node in (head, worker):
        argv = node.vllm_call()["argv"]
        envs = [argv[i + 1] for i, a in enumerate(argv) if a == "--env"]
        for pair in FIXTURE_VEC_INF_ENV.split(","):
            assert pair in envs, (pair, envs)
        # Expanded on the rank, from its own step.
        assert "CUDA_VISIBLE_DEVICES=0,1,2,3" in envs


def test_master_is_the_first_hsn_digits_address(rank_script, tmp_path):
    head = Node(tmp_path, "gh101", IP_HEAD, tmp_path / "rendezvous")

    proc = head.run(rank_script, "--master")

    assert proc.returncode == 0, proc.stderr
    assert proc.stdout == "10.150.0.11\n"


@pytest.mark.parametrize("args, procid", [(("--master",), None), ((), "0")])
def test_refuses_without_a_fabric_ipv4(rank_script, tmp_path, args, procid):
    node = Node(tmp_path, "gh101", IP_NO_FABRIC, tmp_path / "rendezvous")
    env = {"SLURM_PROCID": procid} if procid is not None else {}

    proc = node.run(rank_script, *args, **env)

    assert proc.returncode == 1
    assert proc.stdout == ""
    assert "llmhub-multinode error: " in proc.stderr
    assert "no hsn<digits> IPv4 on gh101" in proc.stderr
    assert not [c for c in node.calls() if "vllm" in c["argv"]]


def test_rank_zero_must_hold_the_master_address(rank_script, tmp_path):
    worker = Node(tmp_path, "gh102", IP_WORKER, tmp_path / "rendezvous")

    proc = worker.run(rank_script, SLURM_PROCID="0", LLMHUB_MN_NNODES="1")

    assert proc.returncode == 1
    assert "rank 0 on gh102 has 10.150.0.12, not the master address" in proc.stderr
    assert not [c for c in worker.calls() if "vllm" in c["argv"]]


def test_barrier_gives_up_and_vec_inf_reports_it(rank_script, tmp_path):
    head = Node(tmp_path, "gh101", IP_HEAD, tmp_path / "rendezvous")

    proc = head.run(rank_script, SLURM_PROCID="0", LLMHUB_MN_BARRIER_TIMEOUT="2")

    assert proc.returncode == 1
    assert "rank 0: 1 of 2 ranks started within 2s" in proc.stderr
    assert not [c for c in head.calls() if "vllm" in c["argv"]]
    # The job's .err carries that line; vec-inf's own poll must call it FAILED.
    log_dir = tmp_path / "log"
    log_dir.mkdir()
    (log_dir / "m.1.err").write_text(proc.stderr)
    status = is_server_running("m", "1", str(log_dir))
    assert status[0].value == "FAILED", status
    assert "ranks started within" in status[1]


def test_quoting_survives_the_rank_shell(rank_script):
    """The container command is word-split once, on the rank, like vec-inf's."""
    text = rank_script.read_text()
    line = next(x for x in text.splitlines() if x.startswith("set -- "))
    words = shlex.split(line.rstrip(" \\")[len("set -- ") :])
    assert words[:3] == ["apptainer", "exec", "--nv"]
    assert words[-2] == "--containall"
