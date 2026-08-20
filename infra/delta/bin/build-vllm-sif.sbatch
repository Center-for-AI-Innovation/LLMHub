#!/bin/bash
#SBATCH --job-name=build-vllm-sif
#SBATCH --account=bfmz-delta-cpu
#SBATCH --partition=cpu
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=8
#SBATCH --mem=64G
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

echo "=== building (this pulls ~10 GB of layers; expect 15-40 min) ==="
time apptainer build "$STAGE_SIF" "$IMAGE_URI"
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
