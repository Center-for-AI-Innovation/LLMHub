#!/bin/bash
#SBATCH --job-name=build-vllm-sif
#SBATCH --account=bfmz-delta-cpu
#SBATCH --partition=cpu
#SBATCH --nodes=1
#SBATCH --ntasks=1
# 16 CPUs / 150 GB is not arbitrary. mksquashfs sizes its memory pool at ~25% of
# PHYSICAL RAM — about 62 GB on a 251 GB cn node — and Delta's apptainer.conf
# ships `mksquashfs procs = 0`, so apptainer does not constrain it to the
# cgroup. At 8 CPUs / 64 GB that lands right at the cgroup ceiling and dies:
# jobs 21307782 and 21307943 both hit
#     mksquashfs command failed: exit status 139   (SIGSEGV)
# at ~32 GB MaxRSS. Diagnostic job 21308120 ran mksquashfs directly on the same
# rootfs inside a 16 CPU / 120 GB allocation and it completed cleanly — gzip
# exit 0 (8.3 GB), zstd exit 0 (7.6 GB). Headroom, not tooling, was the issue.
#SBATCH --cpus-per-task=16
#SBATCH --mem=150G
#SBATCH --time=02:00:00
#SBATCH --output=%x-%j.out
#SBATCH --error=%x-%j.err
#
# Build the vLLM Apptainer image for LLMHub on NCSA Delta.
#
# This is the Delta counterpart to devops/apptainers/build_vllm_sif.sbatch,
# which is written for Magic Castle Radiant and does not run here. Differences,
# each of which is load-bearing:
#
#   * No `--fakeroot`. Delta has no subuid/subgid mapping for ordinary users
#     (/etc/subuid has no entry), so --fakeroot fails outright. Apptainer 1.5
#     converts an OCI image to SIF unprivileged, so it is not needed.
#   * No sandbox round-trip. That existed to dodge NFS xattr limits on Magic
#     Castle. Here the build runs on node-local disk, which has no such limit.
#   * No `module load apptainer` — it is /usr/bin/apptainer on Delta.
#   * CPU partition and the *-delta-cpu account. This build uses no GPU;
#     putting it on a GPU partition would idle an A100 for half an hour.
#   * Cache and tmp go on node-local disk, not /projects. Pulling ~10 GB of
#     layers onto Lustre is slow and wasteful, and /projects is at 80% used.
#
# Usage:
#   sbatch infra/delta/bin/build-vllm-sif.sbatch [OUTPUT_SIF]
#
# Default output: /projects/bfmz/dadams/llmhub-containers/vllm-<tag>.sif
# Installing it to /sw/llmhub/vllm.sif is a separate, privileged step.

set -eo pipefail

IMAGE_TAG="${IMAGE_TAG:-v0.19.1}"
IMAGE_URI="${IMAGE_URI:-docker://vllm/vllm-openai:${IMAGE_TAG}}"
OUT_SIF="${1:-${VLLM_OUT_SIF:-/projects/bfmz/dadams/llmhub-containers/vllm-${IMAGE_TAG}.sif}}"

echo "=== build-vllm-sif ==="
echo "host:    $(hostname)"
echo "job:     ${SLURM_JOB_ID:-<no slurm>}"
echo "image:   ${IMAGE_URI}"
echo "output:  ${OUT_SIF}"
echo "started: $(date -Is)"
echo

# --- node-local scratch -------------------------------------------------------
# Prefer a per-job local directory; fall back to /tmp. Never /projects.
LOCAL_BASE="${SLURM_TMPDIR:-/tmp}"
WORK="${LOCAL_BASE}/vllm-sif-build-${SLURM_JOB_ID:-$$}"
mkdir -p "$WORK"
export APPTAINER_CACHEDIR="${WORK}/cache"
export APPTAINER_TMPDIR="${WORK}/tmp"
mkdir -p "$APPTAINER_CACHEDIR" "$APPTAINER_TMPDIR"

cleanup() {
    echo "--- cleaning ${WORK} ---"
    rm -rf "$WORK" || true
}
trap cleanup EXIT

echo "=== scratch ==="
echo "work: ${WORK}"
df -h "$LOCAL_BASE" | tail -1
echo
echo "apptainer: $(apptainer --version)"
echo

# --- build --------------------------------------------------------------------
# Build to node-local disk first, then copy. A partially-written 20 GB file on
# Lustre is worse than a local one, and the local build is markedly faster.
STAGE_SIF="${WORK}/vllm-${IMAGE_TAG}.sif"

# mksquashfs must be told the size of our ALLOCATION, not the node.
# Delta's apptainer.conf ships `mksquashfs procs = 0`, meaning "use every CPU",
# and mksquashfs sizes its memory pool from *physical* RAM. On a 128-core /
# 251 GB cn node inside an 8-CPU / 64 GB cgroup that over-commits badly: the
# first attempt (job 21307782) died with
#   mksquashfs command failed: exit status 139
# which is SIGSEGV, at 30 GB MaxRSS — a crash from over-allocation, not an OOM
# kill. Pinning both to the cgroup makes the step deterministic.
MKSQ_PROCS="${MKSQ_PROCS:-${SLURM_CPUS_PER_TASK:-4}}"
MKSQ_MEM="${MKSQ_MEM:-8G}"

echo "=== building (pulls ~10 GB of layers; expect 15-40 min) ==="
echo "mksquashfs: -processors ${MKSQ_PROCS} -mem ${MKSQ_MEM}"
time apptainer build \
    --mksquashfs-args "-processors ${MKSQ_PROCS} -mem ${MKSQ_MEM}" \
    "$STAGE_SIF" "$IMAGE_URI"
echo

echo "=== built ==="
ls -lh "$STAGE_SIF"
echo

# --- verify before publishing -------------------------------------------------
echo "=== verify: apptainer inspect ==="
apptainer inspect "$STAGE_SIF" || true
echo

echo "=== verify: vllm version inside the image ==="
# No GPU on this node, so only import-level checks are meaningful here.
apptainer exec "$STAGE_SIF" python3 -c 'import vllm; print("vllm", vllm.__version__)' \
    || echo "[WARN] could not import vllm in-image (may need GPU libs at import time)"
echo

# --- publish ------------------------------------------------------------------
mkdir -p "$(dirname "$OUT_SIF")"
echo "=== copying to ${OUT_SIF} ==="
# Copy to a temp name then rename, so a failed copy never leaves a truncated
# file at the destination path something else might pick up.
cp "$STAGE_SIF" "${OUT_SIF}.partial"
mv "${OUT_SIF}.partial" "$OUT_SIF"
chmod 0755 "$OUT_SIF"

echo
echo "=== done ==="
ls -lh "$OUT_SIF"
sha256sum "$OUT_SIF" | tee "${OUT_SIF}.sha256"
echo "finished: $(date -Is)"
echo
echo "To install as the LLMHub image (requires svcdeltallmhub):"
echo "  /sw/admin/scripts/impersonate svcdeltallmhub"
echo "  cp ${OUT_SIF} /sw/llmhub/vllm.sif.new"
echo "  mv /sw/llmhub/vllm.sif /sw/llmhub/vllm.sif.$(date +%Y%m%d).bak"
echo "  mv /sw/llmhub/vllm.sif.new /sw/llmhub/vllm.sif"
