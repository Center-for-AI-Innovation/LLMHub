# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.0] (unreleased)

### Added

- Launch-time Slurm account picker: users choose which allocation to charge before a model starts. ([#51](https://github.com/Center-for-AI-Innovation/LLMHub/issues/51))
- Backend `GET /api/models/slurm-accounts` and frontend `/api/slurm-accounts` routes that list the signed-in user's Slurm accounts.
- Hugging Face gating support: model sync now records each model's HF gating status, `launch_model` fast-exits with a clear error if the requesting user lacks Hub access (missing/invalid `hf_token`) before allocating any GPU resources. The token is used only for that check and for downloading gated weights into the store; it never reaches the job. For gated models launched as an impersonated cluster user, weights are hard-linked from the shared model store into that user's own workspace instead of the infra-wide default.
- `backend/scripts/evict_unused_models.py`, a cleanup script meant to run weekly from cron (not scheduled automatically), that deletes models from the shared Hugging Face cache nobody has launched in 90 days, based on `ModelDeployment` history. The cache directory comes from `MODEL_CACHE_DIR` or `--cache-dir`. Models with no launch history are kept and listed. It also deletes stale entries from the shared torch inductor cache (`COMPILE_CACHE_DIR`).
- Gated models missing from `MODEL_STORE_ROOT` are downloaded there by the backend on first launch, using the user's token. That launch asks the user to retry in a few minutes; the next one hard-links the weights as before.
- The model catalog and active-deployment cards show a "Gated" chip on models whose weights are gated on Hugging Face (or whose gating status couldn't be confirmed), with a tooltip saying a personal Hugging Face token is needed to launch.
- Qwen3.5-35B-A3B model config for the Magic Castle (Radiant) infrastructure, added by user request. ([#96](https://github.com/Center-for-AI-Innovation/LLMHub/pull/96))

### Changed

- Resolve a user's Slurm accounts with `sacctmgr` instead of the Delta-local `/sw/user/scripts/accounts` helper, and omit the placeholder `noalloc` account.
- Derive the cluster username from the signed-in email local-part, using the suffix after `+` for impersonation addresses such as `rohan13+svcllmhubrohan13@ncsa.illinois.edu`.
- `delta-ai-ncsa/environment.yaml` now points at `/projects/modelcache` instead of `/model-weights`, which doesn't exist on DeltaAI.
- Shared-cache write access is granted only on `MODEL_CACHE_DIR` and `COMPILE_CACHE_DIR`, not on every matching bind.
- Delta kit: supports in-job downloads and writes the cache and model store settings to the backend `.env`.
- After login, users land on the model catalog (`/model-library`) instead of chat. Clicking the logo still returns to the landing page.

### Fixed

- HF gating: `launch_model` no longer falls back to a shared `settings.HF_TOKEN` when the requesting user supplies none — that let any user's launch inherit whatever gated repos the service account can see, defeating per-user gating. Only the requesting user's own token now authorizes access.
- HF gating: for impersonated launches, the launch payload (which can carry the user's `hf_token`) is now written to a workspace-scoped file instead of passed inline on the command line, which was visible to any user on the host via `ps`/`/proc/<pid>/cmdline`.
- HF gating: `model_name` is now resolved and containment-checked before being joined into shared-store and per-user workspace paths, closing a path-traversal gap (a crafted model name could otherwise read outside `MODEL_STORE_ROOT` or write outside the per-user workspace).
- HF gating: a failed Hub gating-status lookup no longer silently marks a model as public — a brand-new model fails closed (requires a token and a real per-user Hub check) instead, and a lookup failure on a known model still keeps its cached status. Previously an API error and a confirmed-public repo were indistinguishable, so a genuine gated-to-public transition could also never clear the cache.
- HF gating: the impersonated launch payload file is now readable by the impersonated user. It was created `0600` in an ACL'd workspace, which set the ACL mask to `---` and masked out that user's inherited entry, so every impersonated launch failed with `Could not read payload file: [Errno 13] Permission denied`. The file's ACL is now set explicitly to the owner plus the cluster user, with no group or other access.
- Impersonated launches from the UI now send the derived cluster username; before this, every UI launch in impersonate mode failed with `Cluster username is required`. It also replaces any `clusterUsername` in the request body. The route used to forward the client's body as-is, so a signed-in user could launch as another cluster user.
- `launch_model` ignores `hf_model`, `model_weights_parent_dir`, `work_dir` and `vllm_args` from the request, and launches and looks up gated weights by the access-checked `modelId` rather than the client's `modelName`. A user could otherwise launch any repo or get another gated model's weights; vec-inf also writes `vllm_args` unquoted into the job script. An explicit `num_gpus`/`num_nodes` now sets `--tensor-parallel-size`/`--pipeline-parallel-size` on the server, which vec-inf requires for multi-GPU launches.
- Launches no longer write the user's HF token into the job's `.sbatch` and `.json` files.
- The backend creates `MODEL_STORE_ROOT` as `0700` if it is missing, and refuses to download into or launch from it if anyone besides root, its owner and the service account can get in. The check reads the ACL, so a root locked down with `group::---` and a named service-account entry passes. Downloaded weights are `0644` so hard links work, so the store directory is the only thing keeping the service account's shared group out.
- Deployment requests reject `partition`, `qos`, `time`, `resource_type` and `data_type` values outside Slurm-name characters, and a `modelId` outside vec-inf's model-name characters. vec-inf writes these unescaped into the job script, so a newline or space could add `#SBATCH` options or shell lines. `modelName` is display-only but can't contain control characters. The Cloudflare tunnel lookup now uses `modelId`, which is what the job is named after.
- Pinned `sqlalchemy<2.1`. SQLAlchemy 2.1 maps `postgresql://` to the psycopg (v3) driver, but only psycopg2 is installed, so a fresh install's backend failed at startup with `No module named 'psycopg'`.
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
- Delta deployment kit (`infra/delta/`): one CLI (`llmhub`) that deploys and operates the full stack on the NCSA Delta service VM from a tag, branch or commit — fetches its own runtimes, supports `direct` and `impersonate` execution modes, and includes preflight, smoke and launch tests. ([#57](https://github.com/Center-for-AI-Innovation/LLMHub/pull/57))

### Changed

- Restricted the backend Python requirement to 3.11 only (requires-python, READMEs, AGENTS.md, CI), and pinned pre-commit’s default Python to 3.11 so Black’s env meets its runtime requirement.
- Renamed the `frontend/app/(marketing)` route group to `frontend/app/(home)` for clarity — it's the root `/` landing page.

### Fixed

- `background_service.py`: `shutdown_deployment()`’s return value was not being captured in `_check_expired_deployments()`, leaving `updated` undefined for every expired deployment (shutdown-completion emails were never sent). Fixed by assigning the call’s result to `updated`.
- Added `default_language_version: python3.11` so pre-commit’s Black env uses Python ≥3.10 (Black 26.5.1 requirement).
- Improved contrast and accessibility for status/chip colors, sidebar headings, and the model library search input (visible label via sr-only).
- Fixed several WCAG AA contrast failures in components by switching bare `text-destructive`/`text-secondary` usages to their `-accessible` variants and tightening a few tokens’ lightness.
- Expanded contrast-harness/CI coverage (buttons, dialogs, diff view, home/login pages) so regressions like these are caught automatically going forward.
