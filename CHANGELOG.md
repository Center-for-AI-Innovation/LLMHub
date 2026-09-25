# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.0] (unreleased)

### Added

- Hugging Face gating support: model sync now records each model's HF gating status, `launch_model` fast-exits with a clear error if the requesting user lacks Hub access (missing/invalid `hf_token`) before allocating any GPU resources, and a supplied token is appended to the launch environment. For gated models launched as an impersonated cluster user, weights are hard-linked from the shared model store into that user's own workspace instead of the infra-wide default.
- `backend/scripts/evict_unused_models.py`, a weekly cron job that deletes models from the shared Hugging Face cache nobody has launched in 90 days, based on `ModelDeployment` history. The cache directory comes from `MODEL_CACHE_DIR` or `--cache-dir`. Models with no launch history are kept and listed.

### Changed

- DeltaAI (`delta-ai-ncsa`) now points at the shared `/projects/modelcache` cache instead of the `/model-weights` placeholder, matching Delta.
- After login, users land on the model catalog (`/model-library`) instead of chat. Clicking the logo still returns to the landing page.

### Fixed

- HF gating: `launch_model` no longer falls back to a shared `settings.HF_TOKEN` when the requesting user supplies none — that let any user's launch inherit whatever gated repos the service account can see, defeating per-user gating. Only the requesting user's own token now authorizes access.
- HF gating: for impersonated launches, the launch payload (which can carry the user's `hf_token`) is now written to a workspace-scoped file instead of passed inline on the command line, which was visible to any user on the host via `ps`/`/proc/<pid>/cmdline`.
- HF gating: `model_name` is now resolved and containment-checked before being joined into shared-store and per-user workspace paths, closing a path-traversal gap (a crafted model name could otherwise read outside `MODEL_STORE_ROOT` or write outside the per-user workspace).
- HF gating: a failed Hub gating-status lookup no longer silently marks a model as public — a brand-new model fails closed (requires a token and a real per-user Hub check) instead, and a lookup failure on a known model still keeps its cached status. Previously an API error and a confirmed-public repo were indistinguishable, so a genuine gated-to-public transition could also never clear the cache.
- HF gating: the Hub repo id is now read from vec-inf's `hf_model` field (falling back to `huggingface_id`). `models.yaml` never set `huggingface_id`, so the gating check never ran.
- Bumped `huggingface_hub` minimum to `0.25.0`, the version that actually introduced `auth_check()` and the `huggingface_hub.errors` module this feature depends on.
- Added the missing `0003_snapshot.json` and corrected the `0003_add_model_gated` migration's out-of-order timestamp (older than `0002`'s, which Drizzle uses as a migration watermark) and its absence from `frontend/lib/db/schema.ts`.

## [1.0.0]

### Added

- User-impersonated job launches: backend deployments can submit vec-inf Slurm jobs as the requesting cluster user when impersonation mode is configured, instead of always running as the service account. Direct execution remains supported. ([#40](https://github.com/Center-for-AI-Innovation/LLMHub/pull/40))
- Local Docker stack for running the full app (frontend + backend) locally via Compose. ([#54](https://github.com/Center-for-AI-Innovation/LLMHub/pull/54))
- Magic Castle Terraform configuration and documentation for deploying LLMHub on an HPC cluster (Slurm controller, login node, GPU compute nodes, NFS storage, optional Caddy reverse proxy for public access). ([#48](https://github.com/Center-for-AI-Innovation/LLMHub/pull/48))

## [0.1.1]

### Added

- GitHub Actions CI workflow and pre-commit hooks (black, isort, ESLint) for linting and formatting, which surfaced and applied linting/formatting changes across the backend and frontend. ([#22](https://github.com/Center-for-AI-Innovation/LLMHub/issues/22))
- UIUC design-system semantic tokens (status-*, secondary-accessible, destructive-accessible) and design-system docs; components now use theme tokens instead of hardcoded hex/zinc colors.
- Playwright + axe contrast checks: CI job, manual pre-commit hook (frontend-contrast-check), and a dev-only contrast harness page.
- CI job that fails a PR to `main` if `CHANGELOG.md` is not updated.

### Changed

- Restricted the backend Python requirement to 3.11 only (requires-python, READMEs, AGENTS.md, CI), and pinned pre-commit’s default Python to 3.11 so Black’s env meets its runtime requirement.
- Renamed the `frontend/app/(marketing)` route group to `frontend/app/(home)` for clarity — it's the root `/` landing page.

### Fixed

- `background_service.py`: `shutdown_deployment()`’s return value was not being captured in `_check_expired_deployments()`, leaving `updated`undefined for every expired deployment (shutdown-completion emails were never sent). Fixed by assigning the call’s result to `updated`.
- Added `default_language_version: python3.11` so pre-commit’s Black env uses Python ≥3.10 (Black 26.5.1 requirement).
- Improved contrast and accessibility for status/chip colors, sidebar headings, and the model library search input (visible label via sr-only)
- Fixed several WCAG AA contrast failures  in swvweal components by switching bare `text-destructive`/`text-secondary` usages to their `-accessible` variants and tightening a few tokens’ lightness.
- Expanded contrast-harness/CI coverage (buttons, dialogs, diff view, home/login pages) so regressions like these are caught automatically going forward.
