# Glossary

**Active models**
:   The page listing your running (and recently finished) deployments, with
    chat, API, logs, share, and stop actions.

**Always-on model**
:   A small model served continuously outside the per-user deployment flow.
    Powers guest mode and the model picker's fallback.

**Apptainer**
:   The container runtime used on the clusters (the HPC-friendly fork of
    Singularity). vLLM runs inside a per-cluster `.sif` image.

**Artifact**
:   Long generated content (code, documents) rendered in its own panel in
    the chat UI instead of as raw markdown in the stream.

**Better Auth**
:   The authentication library used by the frontend; CILogon is its OIDC
    provider.

**CILogon**
:   The institutional identity federation service used to sign in with
    university credentials.

**Deployment (model deployment)**
:   One running instance of a model: a Slurm job running vLLM, with status,
    owner, endpoint, and lifetime. "Launching a model" creates one.

**Downloading**
:   Deployment status while weights are fetched into the cluster's shared
    cache on first launch. Stopping here cancels the launch.

**Gated model**
:   A model whose weights require accepting a license on Hugging Face.
    Launches need the user's own HF token; it is never stored.

**Guest mode**
:   Chatting without signing in, against the always-on model, with a small
    message limit.

**Impersonate mode**
:   An execution mode where inference jobs run under the signed-in user's
    derived cluster account (with ACL'd workspaces) instead of the service
    account, charging GPU time to the user's allocation.

**Magic Castle (Radiant)**
:   A Terraform-defined slurm cluster on NCSA's OpenStack cloud, with
    LLMHub on its login node.

**vec-inf**
:   The launcher library the backend uses to render Slurm job scripts for
    vLLM and submit them (`sbatch`).

**vLLM**
:   The inference server that runs the model inside the Slurm job, exposing
    an OpenAI-compatible API.

**Pipeline parallelism (PP)**
:   Splitting a model's layers across nodes, one stage per node. Set by the
    node count: `--pipeline-parallel-size`.

**Tensor parallelism (TP)**
:   Splitting each layer across GPUs within a node. Set by the GPU count:
    `--tensor-parallel-size`.

**Slurm**
:   The job scheduler on the HPC clusters: queues jobs, allocates GPUs,
    enforces walltime and accounts.

**Slurm account**
:   The allocation GPU-hours are charged to; chosen in the launch dialog.

**Walltime**
:   The maximum lifetime requested for a job. Deployments shut down when it
    expires.
