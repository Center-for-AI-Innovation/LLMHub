# LLMHub

LLMHub helps researchers and developers run open source language models on
supercomputing clusters. It provides a web interface for discovering, launching,
chatting with, and sharing model deployments, plus OpenAI-compatible API access
for integrating deployed models into applications.

The project is built for the University of Illinois community and is powered by
NCSA supercomputing infrastructure.

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
- **Secure access**: authenticate users and protect data while running workloads
  on managed cluster infrastructure.

## Repository Layout

This is a monorepo with two main applications:

```text
backend/   FastAPI service for model catalogs, deployment orchestration, logs,
           database access, and cluster-facing job management.

frontend/  Next.js application for the LLMHub web UI, chat experience,
           authentication, model library, and API proxy routes.
```

## Architecture

At a high level, LLMHub is split into:

- **Frontend**: a Next.js app with Better Auth, Drizzle, PostgreSQL, dashboard
  pages, chat UI, model library, and public/private API routes.
- **Backend**: a FastAPI service that manages model metadata, deployment state,
  and integration with `vec-inf` for cluster-backed inference jobs.
- **Inference runtime**: vLLM-compatible model servers exposed through
  OpenAI-compatible endpoints.
- **Cluster integration**: Slurm and NCSA/HPC configuration supplied through the
  backend environment.

## Local Development

### Prerequisites

- Node.js and `pnpm`
- Python 3.9+ and `uv`
- PostgreSQL
- Access to any required cluster, vLLM, CILogon, and storage credentials for the
  environment you are targeting

### Backend

```sh
cd backend
uv venv --python 3.11
uv pip install -e ".[dev]"
cp .env.example .env
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Backend API docs are available while running:

- Swagger UI: <http://localhost:8000/docs>
- ReDoc: <http://localhost:8000/redoc>

### Frontend

```sh
cd frontend
pnpm install
cp .env.example .env.local
pnpm db:migrate
pnpm dev
```

The frontend runs at <http://localhost:3000>.

## Configuration

Use the checked-in examples as the source of truth for required environment
variables:

- `backend/.env.example`
- `frontend/.env.example`

Common configuration areas include:

- PostgreSQL database URLs
- Better Auth and CILogon authentication settings
- backend API URL used by the frontend
- vLLM/OpenAI-compatible inference endpoints
- Slurm and `vec-inf` cluster settings
- S3-compatible object storage for attachments
- SMTP settings for notifications

Do not commit local `.env`, `.env.local`, credentials, tokens, or cluster account
secrets.

## Development Commands

Backend:

```sh
cd backend
pytest
black .
isort .
flake8
```

Frontend:

```sh
cd frontend
pnpm lint
pnpm format
pnpm build
```

## Maintaining Upstream Subtrees

The backend and frontend directories are maintained as Git subtrees with their
upstream histories preserved.

Configured upstream remotes:

```sh
git remote add backend https://github.com/center-for-ai-innovation/llm-serving-backend.git
git remote add frontend https://github.com/Center-for-AI-Innovation/llm-serving-frontend.git
```

To pull future upstream changes:

```sh
git fetch backend main
git subtree pull --prefix=backend backend main

git fetch frontend main
git subtree pull --prefix=frontend frontend main
```

If `git subtree` is not available in your Git installation, install the Git
subtree helper package for your platform before running these commands.

## License

See [LICENSE](LICENSE).
