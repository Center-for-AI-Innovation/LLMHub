#!/bin/bash
# =============================================================================
# Build the DeltaAI vLLM + Slingshot image. The only supported way to build
# vllm-v0.28.0-slingshot.def -- %setup requires VLLM_RECIPE_DIR and refuses
# to run without it.
#
#   sbatch build-vllm-slingshot.sbatch <output.sif> [recipe-dir]
#
# e.g. from a dev session's run/ directory:
#   sbatch .../build-vllm-slingshot.sbatch \\
#       /work/nvme/bfmz/$USER/vllm-v0.28.0-slingshot-deltaai.sif \\
#       .../src/infra/delta/apptainers/deltaai
#
# The output path is required: the image is ~9 GB and belongs on per-cluster
# scratch, never in this checkout and never on a quota-bearing /projects tree
# (/projects/bfmz is inode-capped and is the only cross-cluster filesystem).
# =============================================================================
# Partition: `ghx4` is the default because it allows 2 days and has no
# per-user running-job cap. For a faster turnaround, override on the command
# line -- sbatch flags beat #SBATCH directives:
#
#   sbatch --partition=ghx4-interactive --time=01:30:00 \
#          build-vllm-slingshot.sbatch <out.sif> <recipe-dir>
#
# Two limits apply there: MaxTime is 02:00:00 (so --time=02:00:00 is the
# ceiling, with no slack if the build runs long) and QOS `qos_ghx4int` has
# MaxJobsPU=1 -- a build occupying it blocks the 2-node NCCL gate from
# running until it finishes. Never use the `full` partition.
#SBATCH --job-name=build-vllm-deltaai
#SBATCH --account=bfmz-dtai-gh
#SBATCH --partition=ghx4
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=1
#SBATCH --cpus-per-task=16
#SBATCH --gpus-per-node=1
#SBATCH --time=02:00:00
#SBATCH --output=build-vllm-slingshot-%j.out
#SBATCH --error=build-vllm-slingshot-%j.err

set -euo pipefail

SIF_OUT="${1:?usage: sbatch build-vllm-slingshot.sbatch <output.sif> [recipe-dir]}"
case "$SIF_OUT" in
    /projects/*) echo "refusing to write the image under /projects -- use /work/nvme"; exit 2 ;;
    /*) ;;
    *)  echo "give an absolute output path"; exit 2 ;;
esac

# %setup reads this. sbatch runs a spool COPY of this script, so $0 cannot
# locate the recipe -- and this workspace submits from the session's run/
# directory (SLURM records CWD as WorkDir, which is how a job is attributed
# back to a session), so SLURM_SUBMIT_DIR is not the recipe directory either.
# Pass it explicitly; the default covers the cd-here-and-sbatch case.
VLLM_RECIPE_DIR="$(cd "${2:-${SLURM_SUBMIT_DIR:-$PWD}}" && pwd)"
export VLLM_RECIPE_DIR
DEF="${VLLM_RECIPE_DIR}/vllm-v0.28.0-slingshot.def"
[ -r "$DEF" ] || { echo "cannot read ${DEF} -- pass the recipe directory as the 2nd argument"; exit 1; }

# Node-local NVMe: /tmp on a gh node is xfs on /dev/nvme0n1, 3.5 T, ~2% used
# (measured job 3166459). Lustre is the wrong filesystem for a squashfs pack.
TMP_BASE="/tmp/${USER}/apptainer-tmp-${SLURM_JOB_ID}"
SANDBOX="/tmp/${USER}/sandbox-${SLURM_JOB_ID}"
# The OCI cache is PERSISTENT and on shared scratch on purpose: the base image
# is ~9 GB and re-pulling it per attempt dominates the iteration time. It is
# regenerable, so losing it costs only the next pull. TMPDIR stays node-local
# (xfs on /dev/nvme0n1) because that is where the extract and squashfs pack
# happen, and Lustre is the wrong filesystem for that.
# Pinned to this allocation, NOT inherited from APPTAINER_CACHEDIR: that is
# commonly set in a user's shell profile to another project's scratch (it
# pointed at /work/nvme/bbka/... here), and a committed build script must not
# write one allocation's build cache into another's tree. Override explicitly
# with LLMHUB_APPTAINER_CACHE if you really mean to.
CACHE_BASE="${LLMHUB_APPTAINER_CACHE:-/work/nvme/bfmz/${USER}/apptainer-cache}"
mkdir -p "$TMP_BASE" "$CACHE_BASE"
export APPTAINER_TMPDIR="$TMP_BASE" APPTAINER_CACHEDIR="$CACHE_BASE"
# SINGULARITY_* are also set site-side and apptainer warns when they disagree.
export SINGULARITY_TMPDIR="$TMP_BASE" SINGULARITY_CACHEDIR="$CACHE_BASE"
echo "cache : ${CACHE_BASE}"
echo "tmpdir: ${TMP_BASE}"

# The sandbox contains files that cannot be removed with a plain rm -- a
# leaked 20 GB tree on a shared node is somebody else's build failure.
cleanup() {
    chmod -R u+rwX "$SANDBOX" 2>/dev/null || true
    # Deliberately NOT removing CACHE_BASE -- see above.
    rm -rf "$TMP_BASE" "$SANDBOX" 2>/dev/null || true
}
trap cleanup EXIT

echo "============================================================"
echo "  DeltaAI vLLM v0.28.0 + Slingshot"
echo "  host   : $(hostname)   $(date -Iseconds)"
echo "  recipe : ${DEF}"
echo "  out    : ${SIF_OUT}"
echo "  apptainer: $(apptainer --version)"
echo "============================================================"

mkdir -p "$(dirname "$SIF_OUT")"
rm -f "$SIF_OUT"

# One-shot build first. This is proven on DeltaAI -- apptainer 1.4.2 packs a
# 5.7 GB image without trouble (bbka DeltaAI-python-installs, job 1958004).
# Delta's mksquashfs SIGSEGV is an apptainer 1.5.1 + bundled-mksquashfs-4.7.5
# fault and does not apply at this version. The fallback below exists because
# this image is larger than the one that proved it, not because it is expected.
if apptainer build --nv "$SIF_OUT" "$DEF"; then
    echo "=== one-shot build OK ==="
else
    echo "=== one-shot build FAILED -- retrying as sandbox + IGNORE_PROOT pack ==="
    rm -f "$SIF_OUT"
    apptainer build --nv --sandbox "$SANDBOX" "$DEF"
    # Scope IGNORE_PROOT to the PACK step only: %post genuinely needs proot's
    # fakeroot here (no apptainer-suid, no /etc/subuid entry for this user --
    # measured job 3166459).
    APPTAINER_IGNORE_PROOT=1 \
        apptainer build --mksquashfs-args "-processors ${SLURM_CPUS_PER_TASK}" "$SIF_OUT" "$SANDBOX"
fi

ls -lh "$SIF_OUT"
echo "sha256: $(sha256sum "$SIF_OUT" | cut -d' ' -f1)"

echo
echo "=== in-image checks (no fabric needed) ==="
apptainer exec --containall "$SIF_OUT" bash -c '
  set -e
  echo -n "vllm      : "; python3 -c "import vllm; print(vllm.__version__)"
  echo -n "ray       : "; python3 -c "import ray; print(ray.__version__)"
  echo -n "openssl   : "; python3 -c "import ssl; print(ssl.OPENSSL_VERSION)"
  echo -n "plugin    : "; strings /opt/aws-ofi-nccl/lib/libnccl-net-ofi.so | grep -m1 "Initializing aws-ofi-nccl"
  echo    "recipe    : $(ls /opt/cray-shim/recipe/)"
  echo "ldd plugin (no \"not found\" expected):"
  ldd /opt/aws-ofi-nccl/lib/libnccl-net-ofi.so | sed "s/^/    /"
  ! ldd /opt/aws-ofi-nccl/lib/libnccl-net-ofi.so | grep -q "not found"
'

echo
echo "=== GPU smoke (this node) ==="
apptainer exec --nv "$SIF_OUT" python3 -c "
import torch
print('torch', torch.__version__, 'cuda', torch.version.cuda)
print('device', torch.cuda.get_device_name(0))
x = torch.randn(512, 512, device='cuda'); print('matmul', (x @ x.T).shape, 'OK')
"

echo
echo "=== built. NEXT: the two-node NCCL gate before any promotion. ==="
echo "    CXI must be SELECTED, not merely present."
