# Glossary

**Active models**
:   The *Your Active Models* page: deployments you can use that are
    downloading, queued, starting or running, with Chat, API, Logs, Share and
    Stop buttons. Deployments leave the page when they end.

**Allocation**
:   A grant of compute time on a cluster, charged through a *Slurm account*.

**Always-on model**
:   A model some LLMHub sites keep running outside the launch flow, so people
    can chat without launching anything. LLMHub on Delta doesn't have one.

**Apptainer**
:   The container runtime used on the clusters (formerly Singularity). vLLM
    runs inside an Apptainer image.

**Artifact**
:   A panel for long generated documents or code, carried over from the
    template LLMHub was built on. Not ready yet.

**Better Auth**
:   The sign-in library the frontend uses, with CILogon as the identity
    provider.

**CILogon**
:   The identity service you sign in through with your university account.

**Context length**
:   The most text, input plus output, measured in tokens, that a model handles
    in one request. Shown on each model card.

**Deployment**
:   One running copy of a model: a Slurm job running vLLM, with an owner, a
    status and a lifetime. Launching a model creates one.

**Downloading weights**
:   The status of a deployment whose model isn't on the cluster yet. LLMHub
    downloads it, then submits the job. Stopping it here cancels the launch.

**Gated model**
:   A model whose publisher requires you to accept a license on Hugging Face.
    Launching one needs your own Hugging Face token, which LLMHub never
    stores.

**Guest mode**
:   Chatting without signing in, with a few messages to the always-on model.
    Only on sites that have one.

**Impersonate mode**
:   A way of running jobs in which each deployment runs on the cluster as
    the signed-in user's own cluster account, rather than as LLMHub's service
    account.

**Lifetime**
:   How long a deployment stays up once it's running, set in the launch
    dialog. When it runs out, LLMHub shuts the deployment down. Slurm calls
    the job's time limit its *walltime*.

**Magic Castle (Radiant)**
:   A Slurm cluster built with Magic Castle on NCSA's Radiant cloud, with
    LLMHub on its login node.

**Pipeline parallelism**
:   Splitting a model's layers across nodes, for models too big for one node.

**Slurm**
:   The job scheduler on the clusters. It queues jobs, hands out GPUs, and
    enforces time limits and allocations.

**Slurm account**
:   The account a job's GPU time is charged to, chosen in the launch dialog.

**Tensor parallelism**
:   Splitting every layer of a model across the GPUs of one node, so they work
    on each token together.

**Token**
:   The unit models read and write text in: roughly three-quarters of an
    English word.

**vec-inf**
:   The library the backend uses to write Slurm job scripts for vLLM and
    submit them.

**vLLM**
:   The server that runs a model on the GPUs and answers requests through an
    OpenAI-compatible API.
