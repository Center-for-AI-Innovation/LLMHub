#!/bin/bash
#SBATCH --job-name=build-vllm-sif
#SBATCH -p node
#SBATCH --time=02:00:00
#SBATCH --cpus-per-task=8
#SBATCH --mem=80G
#SBATCH --output=/project/def-sponsor00/centos/LLMHub/devops/apptainers/build_vllm_sif.out
#SBATCH --error=/project/def-sponsor00/centos/LLMHub/devops/apptainers/build_vllm_sif.err

module load apptainer
export APPTAINER_TMPDIR=/dev/shm
export APPTAINER_CACHEDIR=/project/def-sponsor00/centos/cache
mkdir -p $APPTAINER_CACHEDIR

# Build sandbox first (NFS doesn't support xattr for direct SIF build)
apptainer build --fakeroot --force \
  --sandbox /dev/shm/vllm_sandbox/ \
  docker://vllm/vllm-openai:v0.19.1

# Convert sandbox to SIF
apptainer build --fakeroot --force \
  /project/def-sponsor00/centos/LLMHub/devops/apptainers/vllm.sif \
  /dev/shm/vllm_sandbox/
