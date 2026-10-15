# Development setup

## Prerequisites

- Node.js and `pnpm`
- Python 3.11 and `uv`
- PostgreSQL
- `pre-commit` for the lint hooks

## Clone and run

Follow [Local development](../self-hosting/local-development.md) to get the
backend and frontend running — the short version:

```sh
# backend
cd backend
uv venv --python 3.11
uv pip install -e ".[dev]"
cp .env.example .env
uvicorn app.main:app --port 8000

# frontend (another terminal)
cd frontend
pnpm install
cp .env.example .env.local
pnpm db:migrate
pnpm dev
```

## Pre-commit hooks

Linting and formatting are managed by
[`pre-commit`](https://pre-commit.com). The config lives in
[`.pre-commit-config.yaml`](https://github.com/Center-for-AI-Innovation/LLMHub/blob/main/.pre-commit-config.yaml)
and runs `black`, `isort`, and `flake8` on backend changes and
`eslint --fix` on frontend changes. Install the git hook once per clone:

```sh
pip install pre-commit   # or: pipx install pre-commit
pre-commit install
```

After that the hooks run automatically on every `git commit`. To run them
across the whole repo on demand:

```sh
pre-commit run --all-files
```

Running the frontend hook requires Node and `pnpm` on your `PATH`. All code
is further verified against linting rules using GitHub Actions — see
[Testing & CI](testing-ci.md).

## Docs site

These docs are a Material for MkDocs site in the same repo. Preview
locally with:

```sh
uv sync --group docs    # repo root
uv run mkdocs serve     # http://localhost:8000
```

CI builds the site with `--strict`, so broken links or bad anchors fail
the build — keep the preview handy while editing pages.
