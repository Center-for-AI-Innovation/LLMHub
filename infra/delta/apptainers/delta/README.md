# vLLM image for LLMHub on NCSA Delta (x86_64, Slingshot)

The inference image vec-inf launches on Delta: upstream `vllm/vllm-openai:v0.19.1`
plus what it needs to use Delta's **Slingshot** fabric for multi-node NCCL, plus
**Ray** for vec-inf's multi-node launcher. The stock image in
`infra/magic-castle/apptainers/` (built for Magic Castle Radiant) has none of that; on Delta it would run, but NCCL would
fall back to TCP sockets — which looks like success and performs like failure.

The Delta deployment serves it from `/sw/llmhub/vllm.sif` (`LLMHUB_VLLM_SIF` in
`infra/delta/config/delta.env`), so impersonated users can read it. DeltaAI's
image is a different recipe: `../deltaai/`.

| File | What it is |
|---|---|
| `vllm-v0.19.1-slingshot.def` | the recipe |
| `build-vllm-slingshot.sbatch` | the only supported way to build it |
| `vendor/aws-ofi-nccl/` | pre-built NCCL network plugin, its provenance and license |

## Build

```bash
cd infra/delta/apptainers/delta
sbatch build-vllm-slingshot.sbatch /work/nvme/<allocation>/$USER/vllm-v0.19.1-slingshot.sif
```

The output path is required — the image is ~9 GB and belongs on per-cluster
scratch, not in this checkout or on a quota-bearing `/projects` tree. CPU
partition, 16 cores; the validated image took 8 min 38 s end to end (job 21500064).

Do **not** run `apptainer build` on the `.def` directly. `%setup` needs
`VLLM_RECIPE_DIR`, which the sbatch exports, and refuses to run without it.

## Why it is built this way — Delta-specific, each one load-bearing

- **Two steps, and the pack step runs with `APPTAINER_IGNORE_PROOT=1`.** Delta
  has no `apptainer-suid` and no `/etc/subuid` entry for ordinary users, so
  apptainer emulates root with proot, and `mksquashfs` under proot SIGSEGVs
  (exit 139) on a tree this size. It is not memory: it died at 150 GB allocated
  and 35 GB used. The sbatch falls back to calling `mksquashfs` directly and
  assembling the SIF by hand if the preferred path fails.
- **A pre-built plugin, not a `%post` compile.** It links the CUDA runtime
  statically, so it does not care about the container's CUDA version, and it
  keeps `%post` trivial — `%post` itself runs under proot here.
- **Host libraries are injected, then pruned against the image.** `%files`
  stages everything `ldd` reports for the plugin; `%post` keeps only the ~6 the
  image lacks. Keeping the rest would put Delta's OpenSSL 3.2.2 ahead of the
  image's 3.0.2 and break Python's TLS, i.e. HuggingFace downloads.
- **Cray libfabric 2.3.1 is copied from the host.** CXI is compiled *into*
  `libfabric.so.1` on Delta (it imports from `libcxi.so.1`), so there is no
  `FI_PROVIDER_PATH`, and `libcxi.so.1` is a hard requirement.
- **The recipe ships inside the image**, at `/opt/cray-shim/recipe/`. A two-step
  build records only a stub as the SIF's `Def.FILE`, so
  `apptainer inspect --deffile` would otherwise succeed and say nothing.

## Validate before promoting

A CPU-node import check proves almost nothing. Before an image replaces
`/sw/llmhub/vllm.sif`:

1. a GPU smoke test on an A100 node;
2. a **two-node** NCCL test that confirms the CXI provider and the OFI plugin
   were actually selected — a silent fallback to sockets passes a naive test;
3. an inference launch through LLMHub.

Promotion writes to `/sw/llmhub` and is done as `svcdeltallmhub` under
`/sw/admin/scripts/impersonate`, which is interactive. Record the promoted
image's sha256 beside it.

## Rebuild note

The base is a pinned tag, but `%post` installs `ray[default,cgraph]==2.58.0`
from PyPI and the staged host libraries follow Delta's OS image. A rebuild is a
new artifact: validate it as one.
