# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.1]

### Added

- GitHub Actions CI workflow and pre-commit hooks (black, isort, ESLint) for linting and formatting, which surfaced and applied linting/formatting changes across the backend and frontend. ([#22](https://github.com/Center-for-AI-Innovation/LLMHub/issues/22))
- Access-granted email notification: users now receive an email when they are added to a deployment, whether shared directly or via a pending invite claimed at signup. Sent through a new `POST /api/models/deployments/{id}/notify-access` backend endpoint, which verifies the user actually has access before sending and deduplicates per (deployment, user) so retries never double-send.

### Fixed

- `background_service.py`: `shutdown_deployment()`'s return value was not being captured in `_check_expired_deployments()`, leaving `updated`undefined for every expired deployment (shutdown-completion emails were never sent). Fixed by assigning the call's result to `updated`.
- Added `default_language_version: python3.11` so pre-commit’s Black env uses Python ≥3.10 (Black 26.5.1 requirement).
