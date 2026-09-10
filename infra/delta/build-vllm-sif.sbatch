#!/bin/bash
#SBATCH --job-name=build-vllm-sif
#SBATCH --account=bfmz-delta-cpu
#SBATCH --partition=cpu
#SBATCH --nodes=1
#SBATCH --ntasks=1
# NOTE: this one-shot build DOES NOT WORK on Delta as of apptainer 1.5.1.
# Use builds/apptainer/vllm/build-vllm-slingshot.sbatch in the
# llm-service-software workspace, which splits the build in two.
#
# An earlier version of this comment claimed the SIGSEGV was memory headroom —
# that mksquashfs sizes its pool at ~25% of physical RAM and overruns the
# cgroup. That was WRONG. Job 21308307 ran with 16 CPUs / 150 GB, used 35.5 GB
# (a 4x margin), already capped the pool with -mem 8G, and still died:
#     job       cpus  --mem   MaxRSS   result
#     21307782     8    64G   31.9 GB  SIGSEGV
#     21307943     8    64G   32.2 GB  SIGSEGV
#     21308307    16   150G   35.5 GB  SIGSEGV
# A cgroup OOM is SIGKILL (137) and reports OUT_OF_MEMORY. All three are
# FAILED 255:0 with a SIGSEGV core. DO NOT RAISE --mem AGAIN.
#
# The cause is proot. apptainer-suid is not installed and /etc/subuid has no
# entry for ordinary users, so apptainer emulates root for the unprivileged
# unpack with proot, and mksquashfs inherits that prooted tree. The cores name
# it: execfn '/tmp/prooted-1634524-76qhWj'. gdb puts the fault in
# order_queue_get() with 61 live threads — squashfs-tools' write-ordering
# queue, perturbed by proot's ptrace interception. proot attaches to the
# source->rootfs step, not to SIF packing: building a SIF from a local
# directory spawns no proot and still yields root/root, so the fix is to
# extract under proot and pack outside it.
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
