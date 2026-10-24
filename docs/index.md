# LLMHub

LLMHub lets researchers run open language models on NCSA's Delta
supercomputer without writing a Slurm script. Pick a model from the catalog,
and LLMHub runs it on the cluster's GPUs; then chat with it in the browser,
share it with your group, or call it from your own code through an
OpenAI-compatible API.

It's being built for researchers at the University of Illinois and is in
limited release. To use it you need a Delta account, a GPU allocation, and an
account enabled for LLMHub.

<div class="grid cards" markdown>

-   :material-rocket-launch-outline:{ .lg .middle } **Launch a model**

    ---

    Pick a model from the library, choose how long you need it and which
    allocation to charge, and LLMHub runs and watches the cluster job for
    you.

    [:octicons-arrow-right-24: Quickstart](getting-started/quickstart.md)

-   :material-chat-outline:{ .lg .middle } **Chat in the browser**

    ---

    Talk to your running models from the web UI, with no client setup.
    Your chats are saved, and you can share one as a read-only link.

    [:octicons-arrow-right-24: Using chat](getting-started/using-chat.md)

-   :material-code-braces:{ .lg .middle } **OpenAI-compatible API**

    ---

    Call your models over REST with a personal API key. Code written for
    the OpenAI SDK usually needs only a new base URL.

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
- **Looking for a specific model?** Browse the
  [Model library](getting-started/model-library.md), or see
  [Requesting new models](deploying/requesting-models.md) if it isn't there.
- **Building an application?** Start with
  [Authentication](api/authentication.md), then
  [Chat completions](api/chat-completions.md).
- **Operating a deployment?** The [Self-hosting](self-hosting/index.md)
  section covers local development, the Delta/DeltaAI service VMs, and the
  Magic Castle (Radiant) cluster.

## Capabilities

- **A curated catalog**: about 90 open models, from half a billion to
  over 100 billion parameters, each with launch settings tested on the cluster. Gated models
  such as Llama work with your own Hugging Face token.
- **Chat in the browser**: streaming replies, reasoning display, image input
  for vision models, and saved history.
- **An OpenAI-compatible API**: chat completions for any running model, with
  a personal API key.
- **Deployment management**: watch status and logs, get email when a model is
  ready or fails, stop it early, and share it with colleagues.
- **Your allocation, your job**: models run as Slurm jobs charged to the
  allocation you pick, on NCSA hardware.

## How it fits together

LLMHub is a monorepo with a Next.js frontend (web UI, chat, authentication,
API proxy routes) and a FastAPI backend (model catalog, deployment
orchestration via `vec-inf`, logs, database access). Inference itself runs in
vLLM inside Slurm jobs on the cluster. The [How It Works](how-it-works/index.md)
section walks through the architecture in detail.
