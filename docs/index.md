# LLMHub

LLMHub helps researchers and developers run open source language models on
supercomputing clusters. It provides a web interface for discovering,
launching, chatting with, and sharing model deployments, plus
OpenAI-compatible API access for integrating deployed models into
applications.

The project is built for the University of Illinois community and is powered
by NCSA supercomputing infrastructure.

<div class="grid cards" markdown>

-   :material-rocket-launch-outline:{ .lg .middle } **Launch a model**

    ---

    Pick a model from the library, choose how long you need it, and LLMHub
    submits and monitors the cluster job for you.

    [:octicons-arrow-right-24: Quickstart](getting-started/quickstart.md)

-   :material-chat-outline:{ .lg .middle } **Chat in the browser**

    ---

    Talk to your running deployments directly from the web UI — no client
    setup, with artifacts, attachments, and shareable chat history.

    [:octicons-arrow-right-24: Using chat](getting-started/using-chat.md)

-   :material-code-braces:{ .lg .middle } **OpenAI-compatible API**

    ---

    Call your deployments over REST with a personal API key. Migration from
    OpenAI-style clients is usually a base-URL change.

    [:octicons-arrow-right-24: API reference](api/index.md)

-   :material-server:{ .lg .middle } **Self-host it**

    ---

    The whole stack — Next.js frontend, FastAPI backend, PostgreSQL, vLLM on
    Slurm — deploys to a VM or a Magic Castle cluster.

    [:octicons-arrow-right-24: Self-hosting](self-hosting/index.md)

</div>

## Where to start

- **New to LLMHub?** Follow the [Quickstart](getting-started/quickstart.md) —
  from sign-in to your first chat in a few minutes.
- **Want a specific model?** See [Requesting new
  models](deploying/requesting-models.md) and the
  [Model library](getting-started/model-library.md).
- **Building an application?** Start with
  [Authentication](api/authentication.md), then
  [Chat completions](api/chat-completions.md).
- **Operating a deployment?** The [Self-hosting](self-hosting/index.md)
  section covers local development, the Delta/DeltaAI service VMs, and the
  Magic Castle (Radiant) cluster.

## Capabilities

- **Pre-configured models**: access ready-to-use language models, including
  state-of-the-art models tuned for performance and efficiency.
- **Custom deployments**: request and deploy models for specific research or
  application needs, including models from the Hugging Face ecosystem.
- **Chat interface**: interact with deployed models directly from the browser.
- **OpenAI-compatible APIs**: call running deployments through REST endpoints
  designed for straightforward migration from OpenAI-style clients.
- **Deployment management**: launch models, view active deployments, inspect
  logs, stop jobs, and share deployments with other users.
- **Secure access**: authenticate users and protect data while running
  workloads on managed cluster infrastructure.

## How it fits together

LLMHub is a monorepo with a Next.js frontend (web UI, chat, authentication,
API proxy routes) and a FastAPI backend (model catalog, deployment
orchestration via `vec-inf`, logs, database access). Inference itself runs in
vLLM inside Slurm jobs on the cluster. The [How It Works](how-it-works/index.md)
section walks through the architecture in detail.
