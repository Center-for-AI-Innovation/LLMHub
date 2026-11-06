"""T3: the job a 2-node vLLM request becomes (LLMHub #173).

One srun step spanning every node, one task per node, any rank's failure ending
the step; vLLM's own rendezvous with the mp executor, never Ray; ranks >= 1
headless; vLLM under ``env -u FI_LOG_LEVEL``; the rank script written into the
job directory; the deployment env on every rank; NCCL debug output never on
stderr, where vec-inf's status poll reads it.
"""

import re

from multinode_helpers import (
    FIXTURE_VEC_INF_ENV,
    TWO_NODE_MODEL,
    Launcher,
    batch_body_without_rank_script,
    rank_script_of,
)


def _launch_two_node(monkeypatch, tmp_path, vec_inf_env=FIXTURE_VEC_INF_ENV):
    launcher = Launcher(monkeypatch, tmp_path, vec_inf_env=vec_inf_env)
    result = launcher.launch(TWO_NODE_MODEL)
    assert result["success"], result
    (script,) = launcher.scripts()
    return script


def _container_command(rank_script):
    """The ``set -- ...`` command every rank execs, joined into one line."""
    match = re.search(r"^set -- (.*?)(?<!\\)\n", rank_script, re.S | re.M)
    assert match, "no 'set --' command in the rank script"
    return re.sub(r"\\\n\s*", "", match.group(1))


def test_one_srun_step_spans_every_node(monkeypatch, tmp_path):
    script = _launch_two_node(monkeypatch, tmp_path)
    body = batch_body_without_rank_script(script)

    assert "#SBATCH --nodes=2" in script
    assert "#SBATCH --ntasks-per-node=1" in script
    srun_lines = [line for line in body.splitlines() if re.match(r"\s*srun\b", line)]
    assert len(srun_lines) == 1, srun_lines
    srun = re.search(r"^srun .*?bash \"\$rank_script\"$", body, re.S | re.M).group(0)
    assert '--nodes="$SLURM_JOB_NUM_NODES"' in srun
    assert '--ntasks="$SLURM_JOB_NUM_NODES"' in srun
    assert "--ntasks-per-node=1" in srun
    assert "--kill-on-bad-exit=1" in srun
    # The API server runs inside the step, not in the batch body.
    assert "vllm serve" not in body


def test_no_ray_and_vllm_native_rendezvous(monkeypatch, tmp_path):
    script = _launch_two_node(monkeypatch, tmp_path)
    command = _container_command(rank_script_of(script))

    assert not re.search(r"\bray\b", script, re.I)
    assert "--distributed-executor-backend mp" in command
    assert command.count("--distributed-executor-backend") == 1
    for flag in ("--nnodes", "--node-rank", "--master-addr", "--master-port"):
        assert flag in command, flag
    # Engine args from the catalog survive.
    assert "--tensor-parallel-size 4" in command
    assert "--pipeline-parallel-size 2" in command
    assert re.search(r"--enforce-eager(\s|$)", command)


def test_rank_zero_serves_and_the_rest_are_headless(monkeypatch, tmp_path):
    rank_script = rank_script_of(_launch_two_node(monkeypatch, tmp_path))

    rank0 = re.search(r'if \[ "\$rank" = 0 \]; then\n(.*?)\nfi\n', rank_script, re.S)
    assert rank0, "no rank-0 branch"
    assert "--served-model-name" in rank0.group(1)
    assert "--port" in rank0.group(1)
    assert "--headless" not in rank0.group(1)
    after = rank_script[rank0.end() :]
    assert re.match(r'exec "\$@" --headless\n', after), after[:80]


def test_vllm_runs_without_fi_log_level(monkeypatch, tmp_path):
    command = _container_command(
        rank_script_of(_launch_two_node(monkeypatch, tmp_path))
    )

    assert re.search(
        r"--containall \S+ env -u FI_LOG_LEVEL vllm serve ", command
    ), command


def test_rank_script_is_written_into_the_job_directory(monkeypatch, tmp_path):
    script = _launch_two_node(monkeypatch, tmp_path)

    job_dir = re.search(r'^job_dir="(.*)"$', script, re.M).group(1)
    assert job_dir == (
        f"{tmp_path}/logs/Qwen2.5/{TWO_NODE_MODEL}.$SLURM_JOB_ID"
    ), "the rank script must live in vec-inf's own job directory"
    assert 'rank_script="$job_dir/llmhub-multinode-rank.sh"' in script
    # Quoted delimiter: nothing in the rank script expands in the batch step.
    assert "cat > \"$rank_script\" <<'LLMHUB_MULTINODE_RANK_SCRIPT'" in script


def test_deployment_env_reaches_every_rank(monkeypatch, tmp_path):
    command = _container_command(
        rank_script_of(_launch_two_node(monkeypatch, tmp_path))
    )

    for pair in FIXTURE_VEC_INF_ENV.split(","):
        assert f'--env "{pair}"' in command, pair
    # Expanded per rank, from that rank's own step.
    assert '--env "CUDA_VISIBLE_DEVICES=$CUDA_VISIBLE_DEVICES"' in command


def test_nccl_debug_never_goes_to_stderr(monkeypatch, tmp_path):
    quiet = rank_script_of(_launch_two_node(monkeypatch, tmp_path / "a"))
    assert "NCCL_DEBUG" not in quiet.replace("NCCL_DEBUG_FILE)=", "")

    noisy = rank_script_of(
        _launch_two_node(
            monkeypatch,
            tmp_path / "b",
            vec_inf_env=FIXTURE_VEC_INF_ENV + ",NCCL_DEBUG=INFO",
        )
    )
    assert re.search(
        r'^export APPTAINERENV_NCCL_DEBUG_FILE="\$\{LLMHUB_MN_JOB_DIR\}/nccl-debug/%h\.%p"$',
        noisy,
        re.M,
    )
    # The file's directory is bound into the container at the same path.
    assert (
        'export APPTAINER_BINDPATH="${APPTAINER_BINDPATH},${LLMHUB_MN_JOB_DIR}/nccl-debug"'
        in noisy
    )

    explicit = rank_script_of(
        _launch_two_node(
            monkeypatch,
            tmp_path / "c",
            vec_inf_env=FIXTURE_VEC_INF_ENV
            + ",NCCL_DEBUG=INFO,NCCL_DEBUG_FILE=/tmp/n.%h",
        )
    )
    assert "APPTAINERENV_NCCL_DEBUG_FILE" not in explicit
