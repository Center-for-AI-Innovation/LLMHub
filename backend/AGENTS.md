# Repository Guidelines

## Project Structure & Module Organization
- `app/controllers/`: FastAPI route handlers.
- `app/services/`: business logic (model lifecycle, status refresh, logs).
- `app/models/`: SQLAlchemy ORM models.
- `app/schemas/`: Pydantic request/response schemas.
- `app/repositories/`: DB session/repository helpers.
- `app/utils/`: integrations (LLM inference, Slurm-facing helpers).
- `config/`: environment and infrastructure-specific configuration.

## Build, Test, and Development Commands
- `./scripts/start.sh`: run API locally.
- `pytest`: run tests in `tests/`.
- `black .`: format Python.
- `isort .`: sort imports.
- `flake8`: lint Python code.

## Coding Style & Naming Conventions
- Python 3.11+, Black/isort formatting (`line-length = 88`).
- Use snake_case for variables/functions; clear schema names for request/response models.
- Keep controller logic thin; place workflow/state handling in `app/services`.
- Keep deployment API naming consistent (`/api/models/deployments` for core actions).

## Testing Guidelines
- Framework: `pytest` with `test_*.py` naming under `tests/`.
- Add tests for service behavior changes (status transitions, launch/shutdown failure paths).
- Validate controller responses for key error and success scenarios.

## Commit & Pull Request Guidelines
- Follow conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`.
- Prefer localized commits per concern (config, controller, service logic separately).
- PRs should include: problem statement, API behavior changes, test evidence, and rollback notes for config changes.

## Security & Configuration Tips
- Keep secrets and cluster-specific credentials out of Git, use .env.example and .env.
- Use environment/config files for Slurm account/partition/resource defaults.
- Validate launch defaults carefully to avoid invalid Slurm node configurations.
