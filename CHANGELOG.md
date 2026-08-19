# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.2]

### Added

- GPU fit estimation and a pre-launch memory gate. `POST /api/fit-estimate` and
  `POST /api/validate-config` expose a vLLM-calibrated memory model (weights + KV +
  internal overhead, tensor-parallel aware, with Delta hardware and SU tables), and the
  launch path certifies the boot contract — `weights + KV(max_model_len × 1) +
  overhead(resolved max_num_seqs) ≤ VRAM` — before vec-inf submits to Slurm. Configs the
  model cannot honestly size (multi-node, non-NVIDIA, unresolvable model metadata,
  unmodeled vLLM flags, catalog-lookup failure) skip the gate with a logged warning
  rather than blocking, and estimator errors fail open. Calibrated against nine live
  vLLM 0.11.0 probes on NCSA Delta and validated end to end on the production container.
  ([#46](https://github.com/Center-for-AI-Innovation/LLMHub/pull/46))
- Launch UI shows live fit, sustainable-concurrency, and SU cost per partition, and
  blocks Launch only on a definite "will not start" — unverifiable configs warn and
  proceed, matching the gate. The `--max-num-seqs` scheduler cap is a readout with an
  explicit override (it reserves no memory; capacity is memory-bound).
- Slurm hardware discovery: `python -m app.services.fit_estimator.discovery` generates a
  partition/VRAM table from `sinfo` for non-Delta clusters, activated via
  `FIT_ESTIMATOR_HARDWARE_YAML`. Ambiguous GPU names resolve to the smallest variant and
  unknown or mixed-GPU partitions are excluded, so an unprobed cluster can only produce
  false rejects.
- `docs/memory-estimator-writeup.tex`/`.pdf` (model derivation, calibration data,
  caveats, live validation) and phase findings in `docs/concurrency-kv-findings.md`.
- `HF_TOKEN` documented in `backend/.env.example`; required in production — without it
  every gated repo resolves as unverifiable and launches ungated.

### Fixed

- `model_service.launch_model()`: `params.get("num_nodes", 1)` never applied its default
  because `model_dump()` always emits the key as `None`; `num_gpus * None` raised
  `TypeError` on every launch that set a GPU count.
- Launch concurrency no longer collapses to a hardcoded UI value; it resolves as user
  override > catalog `--max-num-seqs` > the vLLM V1 default of 1024 (the previous 256
  assumption under-charged internal overhead by ~0.6 GiB per GPU — a confirmed
  false accept, measured live).
- The launch dialog's partition `resource_type` now uses the cluster's real GRES names
  (`nvidia_a40`/`nvidia_a100`/`h200`); Delta's `environment.yaml` allowed values were
  extended to match.
- `/api/fit-estimate` proxy route requires an authenticated session before the backend
  makes outbound Hugging Face requests with the server token.
- Launch dialog no longer re-renders every 400 ms while open, and fit verdicts no longer
  flicker to "pending" on each input change.

## [0.1.1]

### Added

- GitHub Actions CI workflow and pre-commit hooks (black, isort, ESLint) for linting and formatting, which surfaced and applied linting/formatting changes across the backend and frontend. ([#22](https://github.com/Center-for-AI-Innovation/LLMHub/issues/22))
- Access-granted email notification: users now receive an email when a deployment is shared with them. Sent through a new `POST /api/models/deployments/{id}/notify-access` backend endpoint, which verifies the user actually has access before sending and deduplicates per (deployment, user) so retries never double-send.

### Fixed

- `background_service.py`: `shutdown_deployment()`'s return value was not being captured in `_check_expired_deployments()`, leaving `updated`undefined for every expired deployment (shutdown-completion emails were never sent). Fixed by assigning the call's result to `updated`.
- Added `default_language_version: python3.11` so pre-commit’s Black env uses Python ≥3.10 (Black 26.5.1 requirement).
