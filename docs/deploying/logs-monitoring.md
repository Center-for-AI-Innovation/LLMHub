# Logs & monitoring

The **Active models** page is the control panel for your running deployments.

## Deployment cards

Each card shows the model, its current status, the Slurm job, when it
expires, and quick actions:

- **Chat** — open a chat with the deployment.
- **API** — copy ready-made API snippets for this deployment (see
  [Chat completions](../api/chat-completions.md)).
- **Logs** — tail the deployment's stdout/stderr.
- **Share** — give other users access (see
  [Sharing & access](sharing-access.md)).
- **Stop** — shut the deployment down.

## Reading logs

The log viewer streams the deployment's job output. vLLM logs its startup
sequence — weight loading, memory profiling, KV-cache sizing — and then an
`API server started` line when the endpoint is ready.

For a `failed` deployment, read from the bottom up: the actual error is
almost always in the last lines. Common patterns:

| Log line | Meaning |
|---|---|
| `CUDA out of memory` | The model doesn't fit the GPUs with these parallelism settings. |
| `401 / 403` from huggingface.co | Gated model, missing or invalid token. |
| `Slurm job ... PENDING` (job state) | The queue is full or the account lacks access to the partition. |
| Connection refused / readiness timeout | The vLLM server crashed; scroll up for the reason. |

## Expiry

Deployments show the walltime they were launched with and when they expire.
When the time passes, Slurm ends the job and the card's status moves to
`completed` / `shutdown`. Nothing you created is lost — chats, artifacts,
and API keys survive — but the model stops serving until you launch it
again.

## What LLMHub does not do

- It does not auto-restart expired deployments.
- It does not keep a chat running after its model stops; reopening the chat
  shows the history and a prompt to relaunch.
- It does not email you when a deployment fails — watch the cards or the
  logs.
