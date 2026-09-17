# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- Multi-GPU container launches failed on Apptainer: vec-inf 0.9.0 rendered a single comma-joined `--env K1=V1,K2=V2` flag, and Apptainer's pflag CSV parsing rejected the expanded `CUDA_VISIBLE_DEVICES=0,1,2,3` value (`1 must be formatted as key=value`). Slurm script generation now emits one `--env` flag per environment variable so values containing commas survive. ([#56](https://github.com/Center-for-AI-Innovation/LLMHub/issues/56))
- `_ensure_cuda_visible_devices_env()` now drops any pre-existing `CUDA_VISIBLE_DEVICES` field from the incoming environment string — including the stale shell-quoted workaround — and appends exactly one canonical unquoted field, so deployments pre-seeding the quoted `VEC_INF_ENV` workaround are self-healing.
- Added regression tests covering the `CUDA_VISIBLE_DEVICES` field handling and the rendered container launch command (one `--env` per variable, unquoted CUDA field).

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
