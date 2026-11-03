#!/bin/bash
#SBATCH --job-name=build-vllm-slingshot
#SBATCH --account=bfmz-delta-cpu          # override: sbatch --account=<yours>
#SBATCH --partition=cpu
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=16
#SBATCH --mem=150G
#SBATCH --time=02:00:00
#SBATCH --output=%x-%j.out
#SBATCH --error=%x-%j.err
#
# Build vLLM v0.19.1 + Slingshot shim for LLMHub on NCSA Delta.
#
# WHY THIS IS A TWO-STEP BUILD
# ----------------------------
# A one-shot `apptainer build image.sif <source>` fails on Delta as of
# apptainer 1.5.1 (installed 2026-08-17):
#
#     FATAL: while creating squashfs:
#            mksquashfs command failed: exit status 139        (139 = SIGSEGV)
#
# It is NOT out of memory. Measured:
#
#   job       cpus  --mem   MaxRSS   mksquashfs args           result
#   21307782     8    64G   31.9 GB  (apptainer defaults)      SIGSEGV
#   21307943     8    64G   32.2 GB  -processors 8  -mem 8G    SIGSEGV
#   21308307    16   150G   35.5 GB  -processors 16 -mem 8G    SIGSEGV
#
# The last had 4x the headroom it used and still died. A cgroup OOM would be
# SIGKILL (137) and report OUT_OF_MEMORY; all three are FAILED 255:0 with a
# SIGSEGV core. Do not "fix" this by raising --mem.
#
# The cause is proot. apptainer-suid is not installed on Delta and /etc/subuid
# has no entry for ordinary users, so apptainer emulates root for the
# unprivileged unpack with proot -- and mksquashfs inherits that prooted
# process tree. The cores prove it: execfn '/tmp/prooted-1634524-76qhWj'.
# gdb puts the fault in order_queue_get() with 61 live threads: squashfs-tools'
# internal write-ordering queue, perturbed by proot's ptrace interception.
#
# A two-step build (sandbox, then `apptainer build sif sandbox/`) DOES NOT FIX
# THIS. Job 21310444 tried exactly that and died the same way at 72.8 GB
# MaxRSS. The small-image controls that suggested it would work -- a 5 MB
# alpine and a 40 KB directory -- were too small to exercise whatever breaks.
# Note also that step 2 printed no subuid/proot line, so "directory->SIF
# avoids proot" is not the whole mechanism either.
#
# What DOES work, measured on this exact 22 GB rootfs in diagnostic job
# 21308120: invoking mksquashfs DIRECTLY, outside apptainer. gzip exit 0
# (8.3 GB), zstd exit 0 (7.6 GB), same bundled 4.7.5 binary. So this script
# does not ask apptainer to pack at all -- it runs mksquashfs itself and then
# assembles the SIF around the result with `apptainer sif new` + `sif add`.
#
# -all-root is REQUIRED on the direct call. apptainer's own packing path
# forces root/root; a direct mksquashfs preserves dadams:grp_202, which would
# make the image unusable.
#
# %post still runs under proot (it is the unprivileged-unpack path), which is
# why the shim uses a PRE-BUILT aws-ofi-nccl rather than compiling one.
#
# Other Delta-specific choices:
#   * No --fakeroot: no subuid/subgid mapping for ordinary users.
#   * No --nv: %post only makes symlinks and runs ldd. No GPU needed, so this
#     stays on the cpu partition. (DeltaAI's build.sbatch uses --nv because it
#     compiles there; do not copy that flag over.)
#   * No `module load apptainer` -- it is /usr/bin/apptainer on Delta.
#   * Scratch on /tmp: node-local NVMe on Delta cn nodes. Do NOT move to
#     /var/tmp -- on stateless compute nodes it can be tmpfs, whose pages are
#     charged to the job's memory cgroup. That already cost a DeltaAI nemo
#     build an OOM misdiagnosed as "image too big".
#   * gzip by default. This build already changes the packing METHOD on a
#     shared production artifact; changing the compressor at the same time
#     adds a second variable for ~8%. zstd is a recorded opt-in via
#     SQUASHFS_COMP=zstd. apptainer warns "Non-gzip squashfs compression might
#     not work with some installations" -- measure page-in before defaulting.
#
# Usage:  cd infra/delta/apptainers/delta
#         sbatch build-vllm-slingshot.sbatch <OUTPUT_SIF>
#
# OUTPUT_SIF is required. The image is ~9 GB: put it on per-cluster scratch
# (e.g. /work/nvme/<allocation>/$USER/), never in this checkout or on a
# quota-bearing /projects tree.

set -eo pipefail
ulimit -c 0     # a SIGSEGV here would otherwise drop multi-GB cores on /projects

# SLURM copies the batch script to /var/spool/slurmd/, so $0 does NOT resolve
# to the submit directory. Use SLURM_SUBMIT_DIR when running under SLURM.
_here="${SLURM_SUBMIT_DIR:-$(dirname "$(readlink -f "$0")")}"
DEF="${VLLM_DEF:-${_here}/vllm-v0.19.1-slingshot.def}"
IMAGE_TAG="${IMAGE_TAG:-v0.19.1}"
OUT_SIF="${1:-${VLLM_OUT_SIF:-}}"
[ -n "$OUT_SIF" ] || { echo "FATAL: pass the output path: sbatch build-vllm-slingshot.sbatch /work/nvme/<alloc>/\$USER/vllm-${IMAGE_TAG}-slingshot.sif"; exit 1; }
COMP="${SQUASHFS_COMP:-gzip}"

echo "=== build-vllm-slingshot (two-step) ==="
echo "host:    $(hostname)"
echo "job:     ${SLURM_JOB_ID:-<none>}"
echo "def:     ${DEF}"
echo "output:  ${OUT_SIF}"
echo "comp:    ${COMP}"
echo "started: $(date -Is)"
[ -f "$DEF" ] || { echo "FATAL: def not found: $DEF (submit from infra/delta/apptainers/delta, or set VLLM_DEF)"; exit 1; }
# %setup reads the plugin and ships the recipe from here. Check now, not
# twenty minutes into the rootfs unpack.
export VLLM_RECIPE_DIR="$(cd "$(dirname "$DEF")" && pwd)"
for _need in vendor/aws-ofi-nccl/lib/libnccl-net-ofi.so vendor/aws-ofi-nccl/PROVENANCE.md; do
    [ -f "${VLLM_RECIPE_DIR}/${_need}" ] || { echo "FATAL: missing ${VLLM_RECIPE_DIR}/${_need}"; exit 1; }
done
echo "recipe:  ${VLLM_RECIPE_DIR}"
echo "plugin:  $(sha256sum "${VLLM_RECIPE_DIR}/vendor/aws-ofi-nccl/lib/libnccl-net-ofi.so" | cut -c1-16)..."
echo

WORK="${SLURM_TMPDIR:-/tmp}/vllm-slingshot-${SLURM_JOB_ID:-$$}"
SANDBOX="${WORK}/sandbox"
STAGE_SIF="${WORK}/vllm-${IMAGE_TAG}-slingshot.sif"
mkdir -p "$WORK"
export APPTAINER_CACHEDIR="${WORK}/cache" APPTAINER_TMPDIR="${WORK}/tmp"
mkdir -p "$APPTAINER_CACHEDIR" "$APPTAINER_TMPDIR"

KEEP_WORK="${KEEP_WORK:-0}"
cleanup() {
    if [ "$KEEP_WORK" = "1" ]; then
        echo "--- keeping ${WORK} on $(hostname) (KEEP_WORK=1) ---"
        return
    fi
    # The sandbox contains read-only dirs; a bare rm -rf leaves ~25 GB behind.
    # Delta's /tmp is NOT per-job -- other jobs' leftovers were already there.
    echo "--- cleaning ${WORK} ---"
    chmod -R u+rwX "$WORK" 2>/dev/null || true
    rm -rf "$WORK" || true
}
trap cleanup EXIT

echo "=== scratch ==="
df -h "$(dirname "$WORK")" | tail -1
echo "apptainer: $(apptainer --version)"

# --- scratch-filesystem facts, re-measured every build -----------------------
# /var/tmp is tmpfs (RAM) on Delta compute nodes, and tmpfs pages are charged to
# the writing process's memory cgroup -- so APPTAINER_TMPDIR there would count
# build temp against --mem. That is what killed an equivalent DeltaAI build
# (OUT_OF_MEMORY inside mksquashfs, misread as "image too big" and papered over
# by raising --mem). Hence WORK on /tmp, which is real node-local NVMe.
#
# Delta also has no job_container/tmpfs, so /tmp is NOT per-job: it starts with
# other jobs' leftovers and this script must clean up after itself. Measured on
# cn102 (job 22140967) and cn### (21310821); printed each run because it is a
# site property that a CPE or Slurm change could flip.
echo "--- scratch: /tmp and /var/tmp backing stores ---"
echo "    /tmp     fstype=$(stat -f -c %T /tmp)      $(df -h /tmp     | tail -1 | awk '{print $1, $2}')"
echo "    /var/tmp fstype=$(stat -f -c %T /var/tmp)  $(df -h /var/tmp | tail -1 | awk '{print $1, $2}')"
# Is /tmp per-job here? On DeltaAI it is (Slurm job_container/tmpfs) and starts
# empty; the Delta failures showed 25 GB of other jobs' leftovers at job start.
echo "    /tmp in use at job start: $(df -h /tmp | tail -1 | awk '{print $3}')  entries: $(ls -1 /tmp 2>/dev/null | wc -l)"
echo "    job_container/tmpfs configured: $(scontrol show config 2>/dev/null | grep -ci 'job_container' || echo 0)"
echo

# --- step 1/2: def -> sandbox (runs %setup/%post under proot) -----------------
echo "=== step 1/2: build sandbox from def ==="
time apptainer build --sandbox "$SANDBOX" "$DEF"
du -sh "$SANDBOX"
echo

# --- step 2/2: sandbox -> SIF (no proot; the step that used to crash) ---------
# -processors is pinned to the allocation: mksquashfs reads /proc/cpuinfo, not
# the cgroup, so on a 128-core node it would otherwise spawn 128 workers.
# Do NOT add -mem: it never helped and only shrinks the cache.
# --- step 2/3: pack ------------------------------------------------------------
# Preferred: APPTAINER_IGNORE_PROOT=1. strace shows apptainer wraps mksquashfs
# in `proot -S /` on EVERY packing path -- including directory->SIF, which we
# had wrongly certified as proot-free -- and that ptrace wrapper is what
# SIGSEGVs on a 22 GB tree. IGNORE_PROOT drops proot and appends -all-root
# itself, producing the same direct call that succeeds:
#
#   normal:       proot -S / mksquashfs ROOTFS OUT -noappend -comp gzip -quiet -percentage
#   IGNORE_PROOT: mksquashfs           ROOTFS OUT -noappend -comp gzip -quiet -percentage -all-root
#
# Scope it to THIS step only -- step 1's %post genuinely needs proot's fakeroot
# on Delta, which is what "The %post section will be run under the fakeroot
# command" is reporting.
#
# It is preferred over hand-assembly because it stays on apptainer's supported
# path and writes the normal descriptors -- notably Def.FILE, so
# `apptainer inspect --deffile` can still recover the recipe from the artifact.
# Hand-assembly loses that: provenance loss on a shared /sw image.
#
# BUT it has only been verified on a small image. The fallback below is the
# path with a real 22 GB measurement behind it (job 21310613), so try the
# clean one and drop to the proven one rather than lose the job.
echo "=== step 2/3: pack SIF (APPTAINER_IGNORE_PROOT=1) ==="
PACK_METHOD="ignore-proot"
set +e
time env APPTAINER_IGNORE_PROOT=1 apptainer build \
    --mksquashfs-args "-comp ${COMP} -processors ${SLURM_CPUS_PER_TASK:-16}" \
    "$STAGE_SIF" "$SANDBOX"
pack_rc=$?
set -e

if [ "$pack_rc" -ne 0 ] || [ ! -s "$STAGE_SIF" ]; then
    echo
    echo "=== IGNORE_PROOT pack FAILED (rc=${pack_rc}) -- falling back ==="
    echo "=== step 2b/3: mksquashfs DIRECTLY, then assemble the SIF ==="
    echo "NOTE: this path loses the Def.FILE descriptor -- apptainer inspect"
    echo "      --deffile will not recover the recipe from the image."
    PACK_METHOD="direct+assemble"
    rm -f "$STAGE_SIF"
    SQUASH="${WORK}/rootfs.squashfs"
    # -all-root is REQUIRED: apptainer's path forces root/root, a direct
    # mksquashfs would otherwise preserve dadams:grp_202.
    time /usr/libexec/apptainer/bin/mksquashfs "$SANDBOX" "$SQUASH" \
        -comp "${COMP}" -processors "${SLURM_CPUS_PER_TASK:-16}" \
        -noappend -all-root
    ls -lh "$SQUASH"
    apptainer sif new "$STAGE_SIF"
    # datatype 4=Partition, partarch 2=amd64, parttype 2=PrimSys, partfs 1=Squash
    apptainer sif add "$STAGE_SIF" "$SQUASH" \
        --datatype 4 --partarch 2 --parttype 2 --partfs 1
fi

echo
echo "=== packed via: ${PACK_METHOD} ==="
apptainer sif list "$STAGE_SIF"
ls -lh "$STAGE_SIF"
echo
echo "=== provenance: is the REAL recipe recoverable? ==="
# Do NOT assert on the mere presence of a Def.FILE descriptor. In a two-step
# build it exists and is a 66-byte stub naming the sandbox path -- inspect
# --deffile succeeds and tells you nothing. Assert on CONTENT.
_def_lines=$(apptainer inspect --deffile "$STAGE_SIF" 2>/dev/null | wc -l)
echo "  Def.FILE descriptor: ${_def_lines} lines (a stub is ~2 -- expected here)"
# The redirect must happen INSIDE the container: a bare `cmd < /opt/...` opens
# the path on the host, which does not exist, and the check reported FAIL on
# an image that did ship the recipe (job 21500064).
_shipped=$(apptainer exec "$STAGE_SIF" sh -c 'wc -l < /opt/cray-shim/recipe/vllm-v0.19.1-slingshot.def' 2>/dev/null || echo 0)
if [ "${_shipped}" -gt 50 ]; then
    echo "  recipe shipped in-image: ${_shipped} lines at"
    echo "    /opt/cray-shim/recipe/vllm-v0.19.1-slingshot.def   <- this is the real one"
else
    echo "  FAIL: recipe NOT shipped in-image; this artifact is not self-describing"
fi
echo

# --- verify -------------------------------------------------------------------
# The dir->SIF path forces root/root but PRESERVES the source tree's mode bits,
# a seam the old one-shot build never exposed. Flag any top-level dir missing
# o+x -- except /root, which is 0700 on every normal Linux image.
echo "=== verify: top-level modes (expect none flagged) ==="
apptainer exec "$STAGE_SIF" find / -maxdepth 1 -mindepth 1 -type d \
    ! -name root ! -perm -o+x -printf '  NOT WORLD-TRAVERSABLE: %M %p\n' 2>/dev/null || true
echo "  (no lines above = OK)"
echo

echo "=== verify: container OpenSSL NOT shadowed by the host's ==="
# Delta is 3.2.2, this base is 3.0.2. If the host copy won, HTTPS model
# downloads from HuggingFace break. Must report the CONTAINER's version.
apptainer exec "$STAGE_SIF" python3 -c 'import ssl; print("  ", ssl.OPENSSL_VERSION)' 2>&1 || true
apptainer exec "$STAGE_SIF" bash -c 'ldconfig -p | grep -E "libssl|libcrypto" | head -4' 2>&1 || true
echo

echo "=== verify: Slingshot shim present ==="
apptainer exec "$STAGE_SIF" bash -c '
  echo "-- plugin:";   ls -l /opt/aws-ofi-nccl/lib/ 2>&1
  echo "-- kept host libs (should be ~6, NOT the whole ldd list):"; ls -l /opt/cray-shim/lib/ 2>&1
  # CXI is compiled INTO libfabric.so.1 on Delta; the provider dir is empty.
  # Do NOT check for a cxi .so here -- that check would always fail and mean nothing.
  echo "-- env:"; env | grep -E "NCCL_NET_PLUGIN|NCCL_SOCKET_IFNAME|FI_LOG_LEVEL"
' || echo "[WARN] shim verification hit an error"

# These two run as separate exec calls ON PURPOSE. Nesting them inside the
# bash -c '...' above put single quotes inside a single-quoted string, which
# closed it early: the block died with "unexpected EOF" and the LD_LIBRARY_PATH
# check -- the most important one here -- never ran at all. It printed a [WARN]
# rather than passing silently, which is the only reason it was noticed.
echo "-- cxi markers in injected libfabric:"
apptainer exec "$STAGE_SIF" python3 -c \
  "d=open('/opt/cray-shim/lib/libfabric.so.1','rb').read(); n=d.count(b'cxi_'); print('   markers:',n); print('   OK' if n>0 else '   FAIL: no cxi')" 2>&1 || true

# The shim must resolve from the ldconfig cache ALONE. If it only resolves via
# %environment, any job that resets LD_LIBRARY_PATH (module load, srun
# --export, a user script) loses it and NCCL falls back to sockets -- silently,
# looking like a performance problem rather than a broken image.
echo "-- ldd with LD_LIBRARY_PATH CLEARED (0 not-found required):"
_nf=$(apptainer exec "$STAGE_SIF" env -u LD_LIBRARY_PATH \
        ldd /opt/aws-ofi-nccl/lib/libnccl-net-ofi.so 2>&1 | grep -c 'not found' || true)
echo "   not-found: ${_nf}"
[ "${_nf}" = "0" ] || echo "   FAIL: shim does NOT survive a cleared LD_LIBRARY_PATH"

# Host libs resolving against container libs of the same SONAME but a different
# build show up here. Not fatal, but it is the aggressive-prune counterpart to
# the OpenSSL problem, and only the multi-node NCCL test settles it.
echo "-- symbol-versioning warnings (informational):"
apptainer exec "$STAGE_SIF" env -u LD_LIBRARY_PATH \
    ldd /opt/aws-ofi-nccl/lib/libnccl-net-ofi.so 2>&1 \
    | grep 'no version information' | sed 's/^/   /' || echo "   none"
echo

echo "=== verify: vllm imports (CPU node -- WEAK check, proves almost nothing) ==="
apptainer exec "$STAGE_SIF" python3 -c 'import vllm; print("vllm", vllm.__version__)' \
    || echo "[WARN] could not import vllm on a CPU node (may need GPU libs at import)"
echo

# --- publish to OUTPUT_SIF (NOT to /sw/llmhub) ---------------------------------
mkdir -p "$(dirname "$OUT_SIF")"
df -h "$(dirname "$OUT_SIF")" | tail -1
cp "$STAGE_SIF" "${OUT_SIF}.partial"
mv "${OUT_SIF}.partial" "$OUT_SIF"
chmod 0755 "$OUT_SIF"
ls -lh "$OUT_SIF"
sha256sum "$OUT_SIF" | tee "${OUT_SIF}.sha256"
echo "finished: $(date -Is)"

cat <<'NEXT'

=== NOT DONE YET ===
This image is NOT validated. A CPU-node import check establishes almost nothing.
Before anything is copied to /sw/llmhub/vllm.sif:
  1. GPU smoke test on a gpuA100x4 node.
  2. Multi-node NCCL test -- the entire point of the shim. Confirm the CXI
     provider is selected and the OFI plugin loads; NCCL silently falling back
     to Socket transport looks like success.
  3. Compare top-level modes against the current production image.
/sw/llmhub/vllm.sif is world-executable and consumed by the LLMHub backend.
Promotion is a separate, privileged step (svcdeltallmhub).
NEXT
