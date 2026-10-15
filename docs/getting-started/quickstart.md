# Quickstart

This guide takes you from sign-in to your first chat with a self-deployed
model.

## 1. Sign in

1. Open the LLMHub URL for your institution (for the University of Illinois
   deployment, ask your instructor or research group lead, or contact the
   administrators).
2. Sign in with your institutional account — LLMHub uses CILogon, so you can
   authenticate with your university credentials.
3. After signing in you land on the **model library**, the catalog of models
   available on your cluster.

!!! note "Just looking around?"

    LLMHub has a guest mode with limited messages against an always-on model
    — no account needed. Sign in when you want to launch your own models.

## 2. Launch a model

1. In the **model library**, find a model that fits your task. The cards show
   each model's size, type, and GPU footprint.
2. Click **Launch** on the model card.
3. In the launch dialog, confirm the settings:

    - **Walltime** — how long the deployment stays up before it is shut down
      automatically.
    - **Partition / resource type** — the cluster's GPU partition the job
      should run on.
    - **Slurm account** — the allocation the GPU-hours are charged to. If you
      have several accounts, pick the right one.
    - **GPUs** — larger models need more GPUs; see
      [GPU resources & parallelism](../deploying/gpu-resources.md).

4. Click **Launch**. The model card moves to **Active models**, and the
   deployment runs through a few statuses:

    | Status | Meaning |
    |---|---|
    | `downloading` | Model weights are being fetched — first launch of a model can take a while. |
    | `pending` / `launching` | The Slurm job is queued or starting. |
    | `ready` / `running` | The vLLM server is up — you can chat now. |
    | `failed` | Something went wrong; check the logs from the card. |

## 3. Chat with your model

1. When the deployment shows **Ready**, click **Chat** on the model card.
2. Type a message and press ++enter++. The first response may take a moment
   while the model warms up.
3. Use the model picker in the composer to switch between your running
   deployments and the always-on model.

See [Using chat](using-chat.md) for attachments, artifacts, sharing chats,
and other features.

## 4. Stop the model when you're done

GPU time is a shared resource. When you're finished:

1. Go to **Active models**.
2. Click **Stop** on the deployment card.

Deployments also stop automatically when their walltime expires, but stopping
early frees the GPUs for everyone else.

## Next steps

- [Using chat](using-chat.md) — attachments, artifacts, and sharing
- [Sharing & access](../deploying/sharing-access.md) — let teammates use your
  deployment
- [API reference](../api/index.md) — call your deployment from code
- [FAQs](faqs.md) — common questions and troubleshooting
