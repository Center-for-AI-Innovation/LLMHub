# aws-ofi-nccl plugin — provenance

- **Binary**: `lib/libnccl-net-ofi.so`
- **Version**: **aws-ofi-nccl 1.16.3**
- **Copied from**: `/u/dadams/rh9-builds/aws-ofi-nccl/install/lib/` (dadams' home build)
- **Built**: 2025-08-27, on Delta (RHEL 9, x86_64)
- **In this repo**: since 2026-09-15, so builds depend on neither a personal
  home directory nor a user's project tree. sha256 `869f11d45d478b43…`, identical
  to the copy that built the image validated and promoted to `/sw/llmhub/vllm.sif`.
- **License**: Apache-2.0 — `LICENSE` and `NOTICE` alongside, from the v1.16.3
  source the binary was built from.

## Why this binary rather than a source build in `%post`

It links the CUDA runtime **statically** (`libcudart_static_*` symbols; `ldd`
shows no `libcudart.so`). The CUDA 12-vs-13 mismatch that forced DeltaAI to
compile aws-ofi-nccl v1.18.0 from source for `vllm_25.12.post1-py3` therefore
does not apply — this plugin is independent of the container's CUDA minor
version.

Avoiding a `%post` compile also avoids compiling under proot, which is how
apptainer 1.5.1 runs unprivileged builds on Delta (no `apptainer-suid`, no
`/etc/subuid` entry).

## Links against Cray libfabric 2.3.1

`/opt/cray/libfabric/2.3.1` is the only libfabric on Delta, so the version the
plugin was built against still matches the host. Re-verify after any CPE update.

## Recovering the version

It is embedded in the binary, so it never has to be guessed:

```console
$ strings lib/libnccl-net-ofi.so | grep aws-ofi
NET/OFI Initializing aws-ofi-nccl 1.16.3
```

Note the Delta module named `aws-ofi-nccl/1.14.2` actually carries **1.16.3** —
the module name and the payload version disagree. Trust the string in the
binary, not the module name.

## Verifying the static-CUDA claim

```console
$ readelf -d lib/libnccl-net-ofi.so | grep NEEDED
  libhwloc.so.15  libfabric.so.1  libstdc++.so.6  libm.so.6  libc.so.6  libgcc_s.so.1
    -> no libcudart.so
$ nm -a lib/libnccl-net-ofi.so | grep -c 'cudart_static\|__cudart'
3167
```

## Watch this if the base image ever changes

`DT_NEEDED` includes `libstdc++.so.6` and `libc.so.6`, which resolve to the
**container's** glibc, not the host's. This plugin was built on RHEL 9.6
(glibc 2.34); the Ubuntu 24.04 base is glibc 2.39, so it is satisfied. Base on
anything older and it fails at dlopen with a `GLIBC_2.x` version error.
