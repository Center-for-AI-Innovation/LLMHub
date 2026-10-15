# Launching a model

Open the **model library**, pick a model, and click **Launch**. The launch
dialog shows the settings the cluster admin has configured as defaults; you
adjust what you need.

## Launch settings

### Walltime

How long the deployment stays up. When the walltime expires the job is shut
down automatically and the GPUs are freed. Pick the shortest walltime that
covers your session — you can always launch again.

!!! tip
    Walltime is a safety net, not a target. Stop the deployment yourself when
    you're done; the walltime only protects shared GPUs from forgotten jobs.

### Partition and resource type

Which GPU partition the job runs on. Most users should keep the default. If
your cluster exposes several GPU types, the model card indicates which types
the model's launch config supports.

### Slurm account

The allocation the GPU-hours are charged to. LLMHub lists the accounts you
belong to — pick the one for the right project. Users with a single account
don't see this choice.

### GPUs and nodes

Larger models need more GPUs. Each model's catalog entry carries tuned
parallelism settings (see
[GPU resources & parallelism](gpu-resources.md)); the dialog reflects them.
Only change these if you know the model's requirements.

### Gated models

If the model is gated on Hugging Face, you'll also be asked for a Hugging
Face access token. See [Gated models](../getting-started/model-library.md#gated-models)
for what happens with it.

## After you click Launch

The card appears under **Active models** and moves through the deployment
statuses:

- `downloading` — fetching weights into the shared cache (first launch only).
  Stopping the deployment here cancels the download and the launch.
- `pending`, `launching` — queued on, or starting on, the cluster.
- `ready`, `running` — you can chat and call the API.
- `failed` — check the logs from the card; common causes are an expired
  token on a gated model, an account problem, or the cluster being full.
- `shutdown`, `completed` — the job ended (walltime or manual stop).

## Stopping a deployment

Click **Stop** on the active model card. This cancels the Slurm job and
frees the GPUs immediately. Your chats and artifacts are kept.
