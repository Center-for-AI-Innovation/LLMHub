# Contributing to LLMHub

Thanks for helping. This file covers what a pull request needs. To set up a
development environment, see the [README](README.md#local-development).

## Before you open a pull request

1. **Update `CHANGELOG.md`.** Add an entry under `[Unreleased]`, in the
   `Added`, `Changed` or `Fixed` section, and link the issue or PR. CI fails
   any PR that doesn't touch `CHANGELOG.md`.
2. **Run the checks for what you changed** (below). CI runs the same ones.
3. **Format with the versions CI uses.** CI pins `black==26.5.1`,
   `isort==8.0.1` and `flake8==7.3.0`; a newer `black` can format differently
   and fail the check. The [pre-commit hooks](README.md#linting--pre-commit)
   run the same tools on `git commit`.
4. **Add testing notes and how-to-test steps to the description.** See
   [below](#testing-notes).

## Checks

Backend, from `backend/`:

```sh
black --check .
isort --check-only --profile black --line-length 88 .
flake8 --config=.flake8 .
pytest
```

Frontend, from `frontend/`:

```sh
pnpm lint
pnpm test            # vitest unit tests
pnpm test:contrast   # Playwright + axe contrast checks (needs: npx playwright install chromium)
```

`pnpm build` also works as a type check, but it runs the database migrations
first, so it needs a database.

Docs, from the repository root:

```sh
uv sync --group docs
uv run mkdocs build --strict
```

## What CI runs

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on pull requests
to `main` and on pushes to `main`. Jobs only run when their part of the repo
changed:

| Job | Runs when | What it does |
|---|---|---|
| `backend` | `backend/**` changed | black, isort, flake8 and pytest |
| `frontend` | `frontend/**` changed | `pnpm lint` and `pnpm test` |
| `contrast` | `frontend/**` changed | `pnpm test:contrast` |
| `changelog` | every pull request | Fails unless `CHANGELOG.md` changed |

Two other workflows:

- [`docs.yml`](.github/workflows/docs.yml) builds the docs site with
  `mkdocs build --strict` on pull requests that touch the docs, and publishes
  it to GitHub Pages on pushes to `main`. Broken links and anchors fail the
  build.
- [`hf-models-check.yml`](.github/workflows/hf-models-check.yml) checks that
  every model in the catalog still resolves on Hugging Face, on catalog
  changes and weekly.

## Tests

- Backend tests are in `backend/tests/` (pytest).
- Frontend unit tests are in `frontend/tests/unit/` (vitest, with jsdom for
  components). Contrast tests use Playwright and axe.
- When you change behavior a user can see, add or extend a test for it.
  `frontend/tests/unit/chat-model-selection.test.ts` and
  `chat-page-model-selection.test.tsx` are good examples: they test behavior
  and mock at module boundaries.
- When you mock an external library or service, build the mock from its real
  schema or a recorded response, not from what the code assumes. Tests fed
  hand-made shapes have let real bugs through.

## Testing notes

Every pull request description has a **Testing** section, so reviewers know
what was actually exercised before they approve:

- **Automated:** what passes (backend and frontend suites, linters), and what
  the new tests prove.
- **Live:** where you ran it (local stack, staging, dev; Delta or DeltaAI;
  direct or impersonate mode), which commit, and the cases you tried, with
  Slurm job IDs and results. Changes to launches, jobs, permissions or
  anything the cluster runs need a live run, not just unit tests.
- **Not covered:** what you didn't test, or only tested with mocks. Say so
  plainly; it tells reviewers where to look.

If the branch changes after review, for example when it's merged with
`main` again, update the section to say what was re-tested on which commit.

For anything bigger than a small fix, also add a **How to test** section:
steps a reviewer can follow to check the change themselves. Give the commands
to run, how to deploy the branch (for example to a staging stack), the cases
to try, and what each should show. Reading a large diff is a poor way to work
out how to exercise it, and the author knows best which cases matter.

## Docs

The user docs are a Material for MkDocs site in `docs/`, published at
<https://center-for-ai-innovation.github.io/LLMHub/>. Preview your changes
with `uv run mkdocs serve`.

The site is for people *using* LLMHub. Setup and operations guides stay in
the READMEs next to the code (`infra/delta/README.md`,
`devops/magic_castle/DEPLOYMENT_GUIDE.md` and others), and the site links
to them. Don't copy them into `docs/`.
