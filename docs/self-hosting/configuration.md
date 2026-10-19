# Configuration reference

Both apps are configured through environment files, never committed with
real values: `backend/.env` (from `backend/.env.example`) and
`frontend/.env.local` (from `frontend/.env.example`). The checked-in
examples are the source of truth for the full variable list; this page maps
the territory.

## Backend (`backend/.env`)

### Core

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL URL for the backend schema (catalog, deployments). |
| `BACKEND_CORS_ORIGINS` | Allowed origins for the frontend, e.g. `["http://localhost:3000"]`. |
| `INFRASTRUCTURE` | Optional explicit infrastructure id: `campus-cluster`, `delta`, `delta-ai-ncsa`, `magic-castle-radiant`. When unset, hostname patterns pick it. |

### HPC / vec-inf

| Variable | Purpose |
|---|---|
| `SLURM_ACCOUNT` / `VEC_INF_ACCOUNT` | Default account for cluster jobs. |
| `VEC_INF_CONFIG_DIR` | Rendered vec-inf configuration directory. |
| `VEC_INF_WORK_DIR` | Direct-mode work directory for jobs. |
| `VEC_INF_LOG_DIR` | Shared log root (also ACL'd for impersonated users). |
| `VEC_INF_SHARED_WORK_ROOT` | Impersonate-mode parent for per-user workspaces; falls back to `VEC_INF_WORK_DIR`, then `VEC_INF_LOG_DIR`. |
| `MODEL_CACHE_DIR` | Shared Hugging Face cache (cleaned by `scripts/evict_unused_models.py`). |
| `COMPILE_CACHE_DIR` | Shared torch inductor cache. |
| `VEC_INF_EXECUTION_MODE` | `direct` (jobs as the service account) or `impersonate` (jobs as the signed-in user). |
| `VEC_INF_IMPERSONATE_SCRIPT` / `VEC_INF_IMPERSONATE_PYTHON` | The wrapper script and Python used in impersonate mode. |
| `VEC_INF_ENV` | Comma-separated `KEY=VALUE` pairs forwarded into the container job environment. |

!!! note
    On Delta, `HF_HUB_CACHE` in `VEC_INF_ENV` must be the real host path
    (vec-inf mounts it as-is); a `/root/...` path breaks the container.

### Background services & email

| Variable | Purpose |
|---|---|
| `SYNC_INTERVAL` | Seconds between model catalog syncs. |
| `EXPIRY_CHECK_INTERVAL` / `MAX_DEPLOYMENTS_PER_CYCLE` | Deployment expiry sweep cadence and batch size. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_FROM` | Unauthenticated campus SMTP relay (must run on a campus IP). |
| `FRONTEND_URL` | Base URL used in notification emails, when set. |
| `SUPPORT_EMAIL` | Contact shown in notification emails, when set. |

## Frontend (`frontend/.env.local`)

### Authentication

| Variable | Purpose |
|---|---|
| `BETTER_AUTH_SECRET` | Better Auth secret (`openssl rand -base64 32`). |
| `BETTER_AUTH_URL` | Public app URL. |
| `CILOGON_CLIENT_ID` / `CILOGON_CLIENT_SECRET` | CILogon OIDC app credentials. |
| `CILOGON_DISCOVERY_URL` | OIDC discovery endpoint. |
| `CILOGON_SKIN` | CILogon sign-in skin. |

### Database & backend

| Variable | Purpose |
|---|---|
| `POSTGRES_URL` | PostgreSQL URL for the frontend schema (auth, chats). |
| `BACKEND_API_URL` | FastAPI backend base URL, e.g. `http://localhost:8000`. |

### Always-on model

| Variable | Purpose |
|---|---|
| `ALWAYS_ON_VLLM_BASE_URL` | OpenAI-compatible base URL of the always-on model. |
| `ALWAYS_ON_VLLM_API_KEY` | Its API key (vLLM ignores it by default). |
| `ALWAYS_ON_VLLM_MODEL` | The model id to serve to guests and as fallback. |

### Test mode

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_USE_LOCAL_TEST_DEPLOYMENTS` | `true` swaps model/deployment routes for local mocks — no cluster needed. |

## Infrastructure configs (YAML)

Beyond env vars, each infrastructure has a committed YAML pair in
`backend/config/infrastructures/<name>/`:

- **`environment.yaml`** — image paths, module load commands, partitions,
  resource types, GPU/CPU/memory limits and defaults, Slurm account
  requirements, bind mounts, log and model directories.
- **`models.yaml`** — the cluster's model catalog: per-model GPU footprint,
  parallelism, context length, and vllm args.

Changes to these files deploy with the backend; they are not read at
runtime from outside the repo.

## Secrets hygiene

- Never commit `.env`, `.env.local`, or any filled-in secrets template.
- Keep env files readable only by the service account (`chmod 600`).
- User-supplied secrets (e.g. Hugging Face tokens) are used for the launch
  only — never stored or written into job files.
