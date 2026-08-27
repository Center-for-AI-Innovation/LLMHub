# AI Inference Backend

This is the FastAPI backend for the LLM-as-a-Service project, providing a RESTful API for model management and connecting the NextJS frontend with the llm-inference package.

## Project Structure

The project follows the controller-service-repository pattern:

- `app/controllers/`: API endpoints and request handling
- `app/services/`: Business logic implementation
- `app/models/`: Database models
- `app/repositories/`: Database access layer
- `app/schemas/`: Pydantic models for request/response validation
- `app/utils/`: Utility functions and helpers
- `app/config/`: Application configuration

## Setup

### Prerequisites

- Python 3.11
- PostgreSQL database (managed by the NextJS frontend using Drizzle)
- uv (Python package manager)

### Installation

1. Clone the repository
2. Create a virtual environment and install dependencies using uv:
   ```
   uv venv --python 3.11
   uv venv
   uv pip install -r pyproject.toml
   ```
3. Create a `.env` file based on `.env.example`:
   ```
   cp .env.example .env
   ```
4. Update the `.env` file with your configuration

### Running the Application

Start the application:
```
uvicorn app.main:app --host 0.0.0.0 --port 8000
```
   
Alternatively, you can use the start script:
```
./scripts/start.sh
```

## API Documentation

Once the application is running, you can access the API documentation at:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Development

### Running Tests

```
pytest
```

### Code Style

This project follows PEP 8 style guidelines. You can check and format your code with:
```
# Check code style
flake8

# Format code
black .
isort .
```

## License

[MIT License](LICENSE)

## Acknowledgements

- [FastAPI](https://fastapi.tiangolo.com/)
- [SQLAlchemy](https://www.sqlalchemy.org/)
- [Pydantic](https://pydantic-docs.helpmanual.io/)
- [llm-inference](https://github.com/VectorInstitute/vector-inference)
- [uv](https://github.com/astral-sh/uv) - Fast Python package installer and resolver

## GPU fit estimator & launch gate

`app/services/fit_estimator/` sizes vLLM deployments before they reach Slurm:
`POST /api/fit-estimate` surveys every partition (fit, bootability, sustainable
concurrency, SU cost) and a pre-launch gate refuses configs whose KV pool
cannot hold one full-context sequence. Configs the model cannot honestly size
(multi-node, non-NVIDIA, unresolvable metadata, unmodeled vLLM flags) skip the
gate with a logged warning instead of blocking. Full derivation, calibration
data, and caveats: `docs/memory-estimator-writeup.tex` (PDF alongside) and
`docs/concurrency-kv-findings.md`.

Ops notes:
- Set `HF_TOKEN` in production — without it, gated models (about half the
  catalog) cannot be sized and launch ungated.
- Port to another Slurm cluster with
  `python -m app.services.fit_estimator.discovery --output hardware.yaml`
  and `FIT_ESTIMATOR_HARDWARE_YAML=/path/to/hardware.yaml` (see the module
  docstring for what transfers automatically and what needs hand-editing).
