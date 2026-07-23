# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.1]

### Added

- GitHub Actions CI workflow and pre-commit hooks (black, isort, ESLint) for linting and formatting, which surfaced and applied linting/formatting changes across the backend and frontend. ([#22](https://github.com/Center-for-AI-Innovation/LLMHub/issues/22))
- UIUC design-system semantic tokens (status-*, secondary-accessible, destructive-accessible) and design-system docs; components now use theme tokens instead of hardcoded hex/zinc colors.
- Playwright + axe contrast checks: CI job, manual pre-commit hook (frontend-contrast-check), and a dev-only contrast harness page.
- CI job that fails a PR to `main` if `CHANGELOG.md` is not updated.

### Changed

- Raised the backend Python requirement to 3.11+ (requires-python, READMEs, AGENTS.md) and pinned pre-commit’s default Python to 3.11 so Black’s env meets its runtime requirement.

### Fixed

- `background_service.py`: `shutdown_deployment()`’s return value was not being captured in `_check_expired_deployments()`, leaving `updated`undefined for every expired deployment (shutdown-completion emails were never sent). Fixed by assigning the call’s result to `updated`.
- Added `default_language_version: python3.11` so pre-commit’s Black env uses Python ≥3.10 (Black 26.5.1 requirement).
- Improved contrast and accessibility for status/chip colors, sidebar headings, and the model library search input (visible label via sr-only)
- `deployment-logs-panel.tsx` rendered "Pending"/"Failed" status badges and warning/error log lines with `text-secondary`/`text-destructive` instead of the accessible variants, failing WCAG AA contrast (as low as 3.3:1); switched to `text-secondary-accessible`/`text-destructive-accessible` and nudged those tokens’ lightness slightly so they clear AA against their real composited backgrounds. Added contrast-harness/CI coverage for this component so future regressions here are caught automatically.
