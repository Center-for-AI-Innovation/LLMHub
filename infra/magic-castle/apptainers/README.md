# vLLM Apptainer image for LLMHub

This directory contains a SLURM batch script that builds the vLLM Apptainer image used by LLMHub to run model inference jobs on the cluster.

## What it produces

| Artifact | Path |
|----------|------|
| vLLM SIF image | `devops/apptainers/vllm.sif` |
| Build stdout | `devops/apptainers/build_vllm_sif.out` |
| Build stderr | `devops/apptainers/build_vllm_sif.err` |

The image is based on the upstream Docker image `vllm/vllm-openai:v0.19.1` and is converted to Apptainer SIF format for use on HPC systems where Apptainer (formerly Singularity) is the supported container runtime.

LLMHub reads the image path from the infrastructure config. On Magic Castle Radiant, that is:

```yaml
# backend/config/infrastructures/magic-castle-radiant/environment.yaml
paths:
  image_path: "/project/def-sponsor00/centos/LLMHub/devops/apptainers/vllm.sif"
  vllm_image_path: "/project/def-sponsor00/centos/LLMHub/devops/apptainers/vllm.sif"
```

When you deploy a model through LLMHub, vec-inf launches inference jobs inside this SIF file.


## How to build

Submit the job from the login node:

```bash
cd /project/def-sponsor00/centos/LLMHub/devops/apptainers
sbatch build_vllm_sif.sbatch
```

Monitor the job:

```bash
squeue -u $USER
```

When the job finishes, confirm the image exists:

```bash
ls -lh vllm.sif
```

Check logs if anything fails:

```bash
tail -f build_vllm_sif.err   # Apptainer progress and warnings
cat build_vllm_sif.out       # usually empty on success
```

A successful build ends with:

```
INFO:    Build complete: /project/def-sponsor00/centos/LLMHub/devops/apptainers/vllm.sif
```
