# Local development

Run the full stack on your machine for development. You need Node.js +
pnpm, Python 3.11 + uv, and PostgreSQL. To actually launch models you also
need access to a Slurm cluster, vLLM/CILogon credentials, and storage — or
use the local test-deployments mode to develop against fake data.

## Prerequisites

- Node.js and `pnpm`
- Python 3.11 and `uv`
- PostgreSQL
- Access to any required cluster, vLLM, CILogon, and storage credentials
  for the environment you are targeting

## Backend

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

## Frontend

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
variables: `backend/.env.example` and `frontend/.env.example`. The common
areas are covered in the [configuration reference](configuration.md).

Never commit local `.env`, `.env.local`, credentials, tokens, or cluster
account secrets.

## Local test deployments

`NEXT_PUBLIC_USE_LOCAL_TEST_DEPLOYMENTS=true` in the frontend environment
switches the model and deployment hooks to local mock routes
(`/api/local/deployments`), so you can build and test the launch/chat flows
without a cluster. This is what the component tests and some smoke tests
run against.

## Docs site (this site)

The documentation you are reading is a Material for MkDocs site that lives
in the same repo:

```sh
uv sync --group docs   # from the repo root
uv run mkdocs serve    # http://localhost:8000
```

## Next steps

- [Repository layout](../contributing/repository-layout.md) for a tour of
  the codebase
- [Testing & CI](../contributing/testing-ci.md) for running the test suites
