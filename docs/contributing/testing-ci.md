# Testing & CI

## Running tests locally

Backend (from `backend/`):

```sh
pytest
```

Frontend (from `frontend/`):

```sh
pnpm test               # vitest unit tests
pnpm test:contrast      # Playwright + axe accessibility/contrast checks
pnpm lint               # eslint
pnpm build              # type-check + production build
```

Docs (from the repo root):

```sh
uv run mkdocs build --strict
```

## CI (`.github/workflows/ci.yml`)

CI runs on PRs targeting `main` and on pushes to `main`, with path filters
so docs-only changes don't rebuild the apps:

| Job | What it does |
|---|---|
| **backend** | `black --check`, `isort --check`, `flake8`, `pytest` — when `backend/**` changes. |
| **frontend** | `pnpm lint`, `pnpm test` — when `frontend/**` changes. |
| **contrast** | Playwright + axe contrast checks on key pages. |
| **changelog** | PRs must update `CHANGELOG.md`. |

### The changelog rule

Every PR updates [`CHANGELOG.md`](https://github.com/Center-for-AI-Innovation/LLMHub/blob/main/CHANGELOG.md)
with an entry describing the change, under `Unreleased` in the appropriate
`Added` / `Changed` / `Fixed` section. CI fails the PR otherwise. Link the
issue or PR number when there is one.

## Docs publishing (`.github/workflows/docs.yml`)

Pushes to `main` that touch `docs/`, `overrides/`, `mkdocs.yml`, or the
workflow itself build the site with `mkdocs build --strict` and publish it
to GitHub Pages. Pull requests run the strict build only — the deploy step
is skipped — so broken links fail the PR, not the site.

## Other workflows

- **`hf-models-check.yml`** — checks Hugging Face model availability for
  the catalog.

## Writing tests

- Backend tests live in `backend/tests/` (pytest).
- Frontend unit tests in `frontend/tests/` (vitest; jsdom for component
  tests — see `vitest.config.ts`).
- Contrast/e2e tests in `frontend/tests/` (Playwright + axe).

When you add a user-visible behavior, add or extend a test next to it; the
chat model selection tests
(`frontend/tests/unit/chat-model-selection.test.ts` and
`chat-page-model-selection.test.tsx`) are a good example of the expected
style: behavior-level, mocked at the module boundary.
