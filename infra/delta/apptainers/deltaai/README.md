# vLLM image for LLMHub on NCSA DeltaAI (aarch64/GH200, Slingshot)

The inference image vec-inf launches on DeltaAI: upstream
`vllm/vllm-openai:v0.28.0` (arm64) plus what it needs to use Slingshot for
multi-node NCCL, plus **Ray** for vec-inf's multi-node launcher.

Sibling of `../delta/`. **The version differs from Delta's v0.19.1 and that is
forced, not chosen** — see "The glibc floor" below. Everything else that
differs is machine, not product.

| File | What it is |
|---|---|
| `vllm-v0.28.0-slingshot.def` | the recipe |
| `build-vllm-slingshot.sbatch` | the only supported way to build it |

## Build

```bash
sbatch build-vllm-slingshot.sbatch \
    /work/nvme/bfmz/$USER/vllm-v0.28.0-slingshot-deltaai.sif \
    <this directory>
```

The output path is required and must not be under `/projects` — the image is
~9 GB, `/projects/bfmz` is inode-capped, and it is the only cross-cluster
filesystem. Pass the recipe directory as the second argument: `sbatch` runs a
spool copy of the script, so it cannot find the recipe on its own.

`ghx4`, 16 cores, 1 GPU. Do **not** run `apptainer build` on the `.def`
directly — `%setup` requires `VLLM_RECIPE_DIR` and refuses without it.

## The glibc floor — why this is not Delta's v0.19.1

`libfabric.so.1` and `libcxi.so.1` each require **GLIBC_2.38** (`objdump -T` on
a DeltaAI login node), and libcxi cannot be dropped: it is a hard `DT_NEEDED`
of libfabric, so without it libfabric does not load at all and the symptom is
"NCCL chose sockets", not a loader error. The base must therefore carry
glibc >= 2.38.

| `vllm/vllm-openai` tag (arm64) | base | glibc | usable here |
|---|---|---|---|
| v0.19.1 … v0.27.1 | Ubuntu 22.04 | 2.35 | **no** |
| **v0.28.0**, v0.29.0 | Ubuntu 24.04 | 2.39 | yes |

Build job **3166512** found this by failing: `%post` died because apptainer's
own fakeroot shim, taken from the SLES host, needed `GLIBC_2.38` and the
container's libc did not have it. Making fakeroot work would only have moved
the failure to runtime.

Two inferences that looked safe and were wrong — do not repeat them, measure:
the arm64 and x86_64 variants of one tag are **not** the same base, and the
Ubuntu bump does **not** track the CUDA bump (CUDA moved 12.9 -> 13.0.2 at
v0.20.0; Ubuntu stayed on 22.04 until v0.28.0).

The floor is asymmetric and DeltaAI is the binding side: Delta's host is glibc
2.34, DeltaAI's is 2.38, so **any base that satisfies DeltaAI also satisfies
Delta**. One version across both clusters is still reachable — at v0.28.0 or
later, not at v0.19.1.

## How this differs from Delta's, and why — all measured

Everything here was measured on DeltaAI 2026-09-17; the node facts come from
job **3166459** on `gh059`.

- **The plugin is built from source, `--without-mpi`.** Delta vendors a
  prebuilt plugin that links CUDA statically and needs six libraries. DeltaAI
  *has* a prebuilt aarch64 plugin — `/sw/user/nccl/aws-ofi-nccl-1.18.0-lf2.3.1-cu12.9`,
  built against this exact libfabric and CUDA 12.9 — but its `DT_NEEDED` pulls
  in the whole Cray PE stack (`libsci_gnu_mpi`, `libsci_gnu`, `libmpi_gnu_123`,
  `libdsmml`, `libxpmem`, `libpmi`, `libpals`) plus a dynamic `libcudart.so.12`
  and `libcupti.so.12`. All of that would have to be staged. A `--without-mpi`
  source build has Delta's minimal closure and no Cray PE dependency. This is
  the path already proven on DeltaAI by the `bbka` DeltaAI-python-installs vLLM
  container (jobs 1955151 / 1957963 / 1958004).
- **`%files` is generated from `ldd` of the host libfabric, not translated.**
  The SLES names differ from Delta's RHEL ones — `libldap_r-2.4.so.2` /
  `liblber-2.4.so.2` against `libldap.so.2` / `liblber.so.2` — and a `%files`
  entry naming a host file that does not exist *fails the build*. The staged
  set is pruned in `%post` against the container's own loader cache, because
  the gap set depends on the base image and must be recomputed, not assumed.
- **No `FI_PROVIDER_PATH`.** The cross-cluster porting note in the `bbka`
  workspace says Delta must drop this "because DeltaAI's CXI provider ships as
  a dlopen'd `.so`". That reason does not hold at libfabric 2.3.1:
  `/opt/cray/libfabric/2.3.1/lib64/libfabric/` is **empty** here too,
  `nm -D --defined-only libfabric.so.1 | grep -ci cxi` is 0 of 40, and
  `libcxi.so.1` is a hard `DT_NEEDED`. The two clusters are the same shape.
  `libcxi.so.1` being staged is what actually matters — without it libfabric
  does not load at all, and the symptom is "NCCL chose sockets".
- **The HPE Slingshot tuning variables are baked into `%environment`.** vec-inf
  runs `apptainer exec --nv … --containall`, which strips the host
  environment, so everything `nccl-ofi-plugin/1.18.0-cuda129` sets would be
  lost. Those values are HPE's, validated on DeltaAI by jobs 1972971 and
  1980946 (96.33 GB/s allreduce at 64 M, 8 GPUs across 2 nodes).
- **One tuning value cannot live in the image.**
  `SLURM_NETWORK=single_node_vni,disable_rdzv_get` is consumed by `srun` on the
  host side, so it goes in `containerization.module_load_cmd` in vec-inf's
  `environment.yaml` — vec-inf emits that verbatim as the first line of the
  job's server script. It is **not required** for the fabric to work: gate job
  3188139 ran with it unset (the shape a VM-side submission has) and selected
  CXI on all 8 ranks. Set it anyway: HPE calls `disable_rdzv_get` required for
  the `FI_CXI_RX_MATCH_MODE=hybrid` set here, and the only at-scale validation
  of these values (jobs 1972971, 1980946) had it set.
- **A plain one-shot `apptainer build` is expected to work.** Delta's
  `mksquashfs` SIGSEGV is an apptainer 1.5.1 + bundled-mksquashfs-4.7.5 fault;
  DeltaAI runs **1.4.2** and packed a 5.7 GB image without it. The sbatch keeps
  a sandbox + `APPTAINER_IGNORE_PROOT=1` fallback because this image is larger
  than the one that proved it — DeltaAI has no `apptainer-suid` and no
  `/etc/subuid` entry either, so the same exposure exists.
- **Build scratch is node-local `/tmp`** — xfs on `/dev/nvme0n1`, 3.5 T, ~2 %
  used. DeltaAI has no `/scratch`; Lustre is the wrong filesystem for a
  squashfs pack.

## Before promoting

Promotion writes `/sw/llmhub`, which other people's impersonated launches read,
so it is an operator step under `/sw/admin/scripts/impersonate svcdeltallmhub`.
Do not promote on the GPU smoke test alone: the gate is a **two-node NCCL run
showing the CXI provider was SELECTED, not merely present**, because a socket
fallback looks like success and performs like failure. Pin what you validated
by SHA256 alongside the logs — a rebuild is a different artifact and does not
inherit the result.
