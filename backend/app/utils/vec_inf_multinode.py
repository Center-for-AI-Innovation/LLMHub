"""Multinode vLLM launches through vec-inf, without Ray.

vec-inf 0.9.0 launches a ``num_nodes > 1`` vLLM job as a Ray cluster: one
``srun`` step for the head, one per worker, and ``vllm serve`` outside all of
them. On DeltaAI that fails four ways, the last because every step gets its own
Slingshot VNI and ranks in different steps cannot talk over CXI (#60, #173).

This adapter replaces that branch, and only that branch. The job runs **one**
``srun`` step with one task per node. Each task runs a rank script, which the
job writes into its own job directory. The script derives the node's fabric
address and execs the same container vec-inf would. Rank 0 runs ``vllm serve``
with the API; the other ranks run ``vllm serve --headless``. They join through
vLLM's own ``--nnodes/--node-rank/--master-addr/--master-port`` with the ``mp``
executor.

Single-node launches, and anything that is not vLLM, go to vec-inf unchanged.

The adapter subclasses private vec-inf classes, so it is tied to the exact
``vec-inf==0.9.0`` pin. ``check_vec_inf_version`` refuses a multinode launch on
any other version instead of falling back to Ray. The contract tests in
``tests/test_multinode_t*.py`` name every vec-inf member used here. Delete this
module once a vec-inf release ships a native multinode launcher.
"""

import shlex
from importlib import metadata
from pathlib import Path
from typing import Any, Dict, Optional

from vec_inf.client._helper import ModelLauncher
from vec_inf.client._slurm_script_generator import SlurmScriptGenerator
from vec_inf.client._slurm_templates import SLURM_SCRIPT_TEMPLATE
from vec_inf.client._slurm_vars import IMAGE_PATH
from vec_inf.client.models import LaunchOptions, LaunchResponse

# The vec-inf releases this adapter was tested against, on hardware, at 2 nodes.
SUPPORTED_VEC_INF_VERSIONS = frozenset({"0.9.0"})

RANK_SCRIPT_NAME = "llmhub-multinode-rank.sh"
# Seconds a rank waits for every other rank to start before giving up.
DEFAULT_BARRIER_TIMEOUT = 300
# First port tried for vLLM's rendezvous (torch.distributed) on the head node.
MASTER_PORT_BASE = 29500

# vLLM's own startup log carries these to the job's .err, which vec-inf scans
# for fatal patterns; the adapter's own failures say "error:" so vec-inf marks
# the job FAILED with that line as the reason.
_ERROR_PREFIX = "llmhub-multinode error:"


class MultinodeLaunchError(RuntimeError):
    """A multinode launch the adapter refuses to submit."""


def installed_vec_inf_version() -> Optional[str]:
    try:
        return metadata.version("vec-inf")
    except metadata.PackageNotFoundError:
        return None


def check_vec_inf_version(installed: Optional[str] = None) -> None:
    """Refuse a multinode launch on a vec-inf the adapter was not tested against.

    Fails closed: an unknown or missing version raises, so a vec-inf bump can
    never route a multinode request back to vec-inf's Ray path unnoticed.
    """
    version = installed if installed is not None else installed_vec_inf_version()
    if version not in SUPPORTED_VEC_INF_VERSIONS:
        raise MultinodeLaunchError(
            f"multinode launch refused: vec-inf {version or '(not installed)'} is "
            "not a version LLMHub's multinode adapter was tested against "
            f"({', '.join(sorted(SUPPORTED_VEC_INF_VERSIONS))})"
        )


def is_multinode_vllm(params: Dict[str, Any]) -> bool:
    """True for the launches this adapter handles, judged on resolved params."""
    return int(params["num_nodes"]) > 1 and params.get("engine", "vllm") == "vllm"


def _render_engine_args(engine_args: Dict[str, Any]) -> list:
    """vec-inf's own rendering of engine args, minus the executor backend."""
    lines = []
    for arg, value in engine_args.items():
        if arg == "--distributed-executor-backend":
            continue
        lines.append(
            f"    {arg} \\" if isinstance(value, bool) else f"    {arg} {value} \\"
        )
    return lines


# Written into the job directory at job time through a quoted heredoc, so every
# ``$`` below expands on the rank, not in the batch step. Depends only on
# ``ip``, ``hostname`` and ``apptainer``. Inputs come from the srun step's
# environment (LLMHUB_MN_*), set by the batch script.
_RANK_SCRIPT = r"""#!/bin/bash
# One vLLM rank per node, inside the job's single srun step. Written by LLMHub's
# multinode adapter (backend/app/utils/vec_inf_multinode.py); runs on the host,
# outside the container, because --containall strips SLURM_*.
#   llmhub-multinode-rank.sh --master   print this node's fabric IPv4 and exit
#   llmhub-multinode-rank.sh            run rank $SLURM_PROCID
set -u
host="$(hostname -s)"

# The first hsn<digits> IPv4, matched exactly: never DNS, which returns the VLAN
# address on Delta, several records on DeltaAI and link-local for the FQDN.
fabric_ipv4() { ip -4 -o addr show | awk '$2 ~ /^hsn[0-9]+$/ {split($4, a, "/"); print a[1]; exit}'; }
fabric_ifaces() { ip -4 -o addr show | awk '$2 ~ /^hsn[0-9]+$/ {printf "%s%s", s, $2; s=","}'; }

if [ "${1:-}" = "--master" ]; then
    addr="$(fabric_ipv4)"
    if [ -z "$addr" ]; then
        echo "__ERROR__ no hsn<digits> IPv4 on ${host}; refusing to guess a master address" >&2
        exit 1
    fi
    echo "$addr"
    exit 0
fi

rank="${SLURM_PROCID:?__ERROR__ not inside srun}"
nnodes="${LLMHUB_MN_NNODES:?}"
ip4="$(fabric_ipv4)"
ifs="$(fabric_ifaces)"
if [ -z "$ip4" ]; then
    echo "__ERROR__ rank ${rank}: no hsn<digits> IPv4 on ${host}" >&2
    exit 1
fi
# Rank 0 hosts the rendezvous, so it must be the node the master was read on.
if [ "$rank" = 0 ] && [ "$ip4" != "${LLMHUB_MN_MASTER_ADDR:?}" ]; then
    echo "__ERROR__ rank 0 on ${host} has ${ip4}, not the master address ${LLMHUB_MN_MASTER_ADDR}" >&2
    exit 1
fi

# Barrier: every rank up before any vLLM starts, so a rank that never arrives
# ends the step (srun --kill-on-bad-exit) instead of leaving rank 0 waiting.
rdv="${LLMHUB_MN_RENDEZVOUS:?}"
mkdir -p "$rdv" && : > "${rdv}/rank-${rank}"
shopt -s nullglob
timeout="${LLMHUB_MN_BARRIER_TIMEOUT:-__BARRIER_TIMEOUT__}"
waited=0
while :; do
    arrived=("${rdv}"/rank-*)
    [ "${#arrived[@]}" -ge "$nnodes" ] && break
    if [ "$waited" -ge "$timeout" ]; then
        echo "__ERROR__ rank ${rank}: ${#arrived[@]} of ${nnodes} ranks started within ${timeout}s" >&2
        exit 1
    fi
    sleep 1
    waited=$((waited + 1))
done
echo "llmhub-multinode: rank ${rank}/${nnodes} on ${host} ip=${ip4} ifaces=${ifs} cuda=${CUDA_VISIBLE_DEVICES:-<unset>} barrier=${waited}s"

# vLLM reads VLLM_PORT as its own base port; keep a stray one out.
unset APPTAINERENV_VLLM_PORT
export APPTAINERENV_VLLM_HOST_IP="$ip4"
export APPTAINERENV_NCCL_SOCKET_IFNAME="=${ifs}"
export APPTAINERENV_GLOO_SOCKET_IFNAME="${ifs%%,*}"
__NCCL_DEBUG_FILE__
# The fabric variables as this rank's container sees them, for the job log.
echo "llmhub-multinode: rank ${rank} container env: $(__PROBE__ \
    | grep -E '^(FI_CXI_RDZV_THRESHOLD|FI_CXI_RDZV_GET_MIN|FI_LOG_LEVEL|FI_PROVIDER|NCCL_NET_PLUGIN|NCCL_DEBUG_FILE)=' | sort | paste -sd' ')"

set -- __CONTAINER__
    __INNER__ \
__VLLM__
    --distributed-executor-backend mp \
    --nnodes "$nnodes" \
    --node-rank "$rank" \
    --master-addr "$LLMHUB_MN_MASTER_ADDR" \
    --master-port "$LLMHUB_MN_MASTER_PORT"

if [ "$rank" = 0 ]; then
    exec "$@" --served-model-name "$LLMHUB_MN_SERVED_NAME" --host 0.0.0.0 --port "$LLMHUB_MN_API_PORT"
fi
exec "$@" --headless
"""

# The image bakes FI_LOG_LEVEL=warn. On DeltaAI libfabric then prints benign
# "Failed to perform cuPointerSetAttribute" warnings from every worker before
# vLLM is ready, and vec-inf's status poll reads "failed to" as fatal (3533520).
# Unsetting it inside the container silences libfabric (3536666: 0 lines).
_INNER_ENV = "env -u FI_LOG_LEVEL"


class MultinodeSlurmScriptGenerator(SlurmScriptGenerator):
    """vec-inf's generator with the multinode vLLM branch replaced.

    The shebang (``#SBATCH --nodes``, ``--ntasks-per-node=1``, gres, output
    files) is vec-inf's own. ``_generate_server_setup`` and
    ``_generate_launch_cmd`` are replaced wholesale, because vec-inf inlines
    its Ray branch in both.
    """

    def __init__(self, params: Dict[str, Any]):
        super().__init__(params)
        if not (self.is_multinode and self.engine == "vllm" and self.use_container):
            raise MultinodeLaunchError(
                "the multinode adapter handles only containerised vLLM jobs on more "
                f"than one node (num_nodes={params['num_nodes']}, "
                f"engine={self.engine}, venv={params['venv']})"
            )

    def _job_dir(self) -> str:
        # vec-inf's job directory; launch() creates it after sbatch returns,
        # so the job creates it too.
        return f'{self.params["log_dir"]}/{self.params["model_name"]}.$SLURM_JOB_ID'

    def _nccl_debug_needs_file(self) -> bool:
        env = self.params.get("env") or {}
        return "NCCL_DEBUG" in env and "NCCL_DEBUG_FILE" not in env

    def _generate_rank_script(self) -> str:
        container = SLURM_SCRIPT_TEMPLATE["container_command"].format(
            env_str=self.env_str, image_path=IMAGE_PATH[self.engine]
        )
        vllm_lines = [
            f"    vllm serve {self.params.get('hf_model') or self.model_weights_path} \\"
        ]
        vllm_lines += _render_engine_args(self.params["engine_args"])
        probe = container.rstrip(" \\") + f" {_INNER_ENV} env 2>/dev/null"
        if self._nccl_debug_needs_file():
            # NCCL's INFO lines on stderr can match vec-inf's fatal patterns, so
            # NCCL debug output goes to a file in the job directory, bound in.
            nccl_debug = (
                'mkdir -p "${LLMHUB_MN_JOB_DIR}/nccl-debug"\n'
                'export APPTAINER_BINDPATH="${APPTAINER_BINDPATH},'
                '${LLMHUB_MN_JOB_DIR}/nccl-debug"\n'
                "export APPTAINERENV_NCCL_DEBUG_FILE="
                '"${LLMHUB_MN_JOB_DIR}/nccl-debug/%h.%p"'
            )
        else:
            nccl_debug = ""
        return (
            _RANK_SCRIPT.replace("__ERROR__", _ERROR_PREFIX)
            .replace("__BARRIER_TIMEOUT__", str(DEFAULT_BARRIER_TIMEOUT))
            .replace("__NCCL_DEBUG_FILE__", nccl_debug)
            .replace("__PROBE__", probe)
            .replace("__CONTAINER__", container)
            .replace("__INNER__", _INNER_ENV)
            .replace("__VLLM__", "\n".join(vllm_lines))
        )

    def _generate_server_setup(self) -> str:
        """Container setup, binds, node list, rank script, ports, job JSON."""
        rank_script = self._generate_rank_script()
        delimiter = "LLMHUB_MULTINODE_RANK_SCRIPT"
        if delimiter in rank_script.splitlines():
            raise MultinodeLaunchError("rank script contains its heredoc delimiter")
        setup = ["\n"]
        setup.append("\n".join(SLURM_SCRIPT_TEMPLATE["container_setup"]))
        setup.append(
            SLURM_SCRIPT_TEMPLATE["bind_path"].format(
                work_dir=self.params.get("work_dir", str(Path.home())),
                model_weights_path=(
                    f"{self.model_weights_path},"
                    if not self.params.get("hf_model")
                    else ""
                ),
                additional_binds=self.additional_binds,
            )
        )
        setup.append(
            SLURM_SCRIPT_TEMPLATE["imports"].format(src_dir=self.params["src_dir"])
        )
        setup.append(
            "\n".join(
                [
                    "\n# Multinode vLLM: one srun step, one rank per node (LLMHub adapter)",
                    'nodes_array=($(scontrol show hostnames "$SLURM_JOB_NODELIST"))',
                    "head_node=${nodes_array[0]}",
                    f'job_dir="{self._job_dir()}"',
                    'mkdir -p "$job_dir"',
                    f'rank_script="$job_dir/{RANK_SCRIPT_NAME}"',
                    f"cat > \"$rank_script\" <<'{delimiter}'",
                    rank_script.rstrip("\n"),
                    delimiter,
                    'master_addr=$(bash "$rank_script" --master) || exit 1',
                ]
            )
        )
        setup.append("\n".join(SLURM_SCRIPT_TEMPLATE["find_server_port"]))
        setup.append(
            "\n".join(
                [
                    "\n# vLLM's rendezvous port, on the head's fabric address",
                    f"master_port={MASTER_PORT_BASE}",
                    'while [ "$master_port" = "$server_port_number" ] \\',
                    "    || ss -tlnH | awk '{print $4}' | grep -q \":${master_port}$\"; do",
                    "    master_port=$((master_port + 1))",
                    "done",
                ]
            )
        )
        setup.append(
            "\n".join(SLURM_SCRIPT_TEMPLATE["write_to_json"]).format(
                log_dir=self.params["log_dir"], model_name=self.params["model_name"]
            )
        )
        return "\n".join(setup)

    def _generate_launch_cmd(self) -> str:
        """One srun step spanning every node; any rank's failure ends it."""
        return "\n".join(
            [
                "\n",
                'echo "llmhub-multinode: head ${head_node} master ${master_addr}:${master_port} '
                'api ${server_address}"',
                'export LLMHUB_MN_JOB_DIR="$job_dir"',
                'export LLMHUB_MN_RENDEZVOUS="$job_dir/rendezvous"',
                'export LLMHUB_MN_NNODES="$SLURM_JOB_NUM_NODES"',
                'export LLMHUB_MN_MASTER_ADDR="$master_addr"',
                'export LLMHUB_MN_MASTER_PORT="$master_port"',
                'export LLMHUB_MN_API_PORT="$server_port_number"',
                f"export LLMHUB_MN_SERVED_NAME={shlex.quote(self.params['model_name'])}",
                'srun --nodes="$SLURM_JOB_NUM_NODES" --ntasks="$SLURM_JOB_NUM_NODES" \\',
                "    --ntasks-per-node=1 --kill-on-bad-exit=1 \\",
                '    bash "$rank_script"',
            ]
        )


class MultinodeLauncher(ModelLauncher):
    """vec-inf's launcher, writing the job with ``MultinodeSlurmScriptGenerator``.

    Parameter resolution, submission, the job JSON and the log layout are
    vec-inf's own, so vec-inf's status and shutdown work on the job unchanged.
    """

    def __init__(self, model_name: str, kwargs: Optional[Dict[str, Any]]):
        check_vec_inf_version()
        super().__init__(model_name, kwargs)
        if not is_multinode_vllm(self.params):
            raise MultinodeLaunchError(
                f"{model_name} resolves to num_nodes={self.params['num_nodes']}, "
                f"engine={self.params.get('engine', 'vllm')}: not a multinode vLLM launch"
            )

    def _build_launch_command(self) -> str:
        self.slurm_script_path = MultinodeSlurmScriptGenerator(
            self.params
        ).write_to_log_dir()
        return f"sbatch {self.slurm_script_path}"


def launch_model(
    client: Any, model_name: str, options: LaunchOptions
) -> LaunchResponse:
    """Launch through vec-inf, sending multinode vLLM through the adapter.

    The choice is made on vec-inf's resolved parameters, not the request: the
    UI sends no node count and the catalog entry decides. Everything else goes
    to ``client.launch_model`` exactly as before.
    """
    # As VecInfClient.launch_model builds it. ModelLauncher deletes the keys it
    # consumes (env, vllm_args), so each launcher gets its own copy.
    kwargs = {k: v for k, v in vars(options).items() if v is not None}
    resolved = ModelLauncher(model_name, dict(kwargs)).params
    if not is_multinode_vllm(resolved):
        return client.launch_model(model_name, options=options)
    return MultinodeLauncher(model_name, dict(kwargs)).launch()
