# How it works

LLMHub is a thin, deliberate layer over standard HPC building blocks: a web
app, a job scheduler, and vLLM. This section explains how the pieces fit
together — useful when debugging, planning a self-hosting deployment, or
contributing.

## The cast

- **Frontend** (Next.js): the web UI — model library, active models, chat,
  profile — plus the auth layer (Better Auth with CILogon) and the API
  proxy routes the UI and public API call.
- **Backend** (FastAPI): the control plane — model catalog, launch
  orchestration, deployment state, logs, email notifications.
- **`vec-inf`**: the launcher library the backend uses to render Slurm job
  scripts and submit vLLM jobs.
- **Slurm**: the cluster scheduler that places jobs on GPU nodes.
- **vLLM**: the inference server that actually runs the model, inside an
  Apptainer container, speaking an OpenAI-compatible protocol.

## The two data paths

**Control path** — everything the UI does (browse, launch, stop, share)
goes browser → Next.js routes → FastAPI → Slurm/`vec-inf`. PostgreSQL holds
the catalog, deployment records, users, and chats.

**Data path** — chat and API tokens stream browser → Next.js proxy routes →
vLLM on the compute node → back. The proxy authenticates the request and
checks deployment access; the model traffic itself never touches the
backend.

Continue with [Architecture](architecture.md) for the component-level view,
or the [Glossary](glossary.md) for the vocabulary.
