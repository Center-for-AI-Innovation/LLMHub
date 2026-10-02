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

`app/services/fit_estimator/` sizes vLLM deployments before they reach Slurm.
`launch_model` refuses a config whose KV pool cannot hold one full-context
sequence, before it downloads gated weights, allocates GPUs or submits a job.
`POST /api/fit-estimate` surveys every partition (fit, bootability, sustainable
concurrency, SU cost), and `POST /api/validate-config` gives a strict verdict.
Configs the model cannot size (unknown partition, multi-node, non-NVIDIA,
unresolvable metadata, unmodeled catalog vLLM flags) skip the gate with a
logged warning instead of blocking. Derivation, calibration data and caveats:
`docs/memory-estimator-writeup.tex` (PDF alongside) and
`docs/concurrency-kv-findings.md`.

Ops notes:
- Gated models are sized only with the requesting user's own HF token; there is
  no server-wide token. The survey endpoints are anonymous, so they report
  gated models as unverifiable.
- Each cluster has its own hardware table, `hardware.yaml`, next to
  `environment.yaml` in the active config directory: `VEC_INF_CONFIG_DIR` when
  set (the Delta kit copies the right one there), otherwise
  `config/infrastructures/<infra>/`. Rows are keyed by partition, plus the GRES
  type (`resource_type`) where a partition mixes GPU types; a launch on such a
  partition that names no GPU type is not gated. Tables exist for Delta,
  DeltaAI and Campus Cluster (Campus Cluster's is a best guess until LLMHub
  has a VM there; see its header). A cluster without one is not gated at all.
- Generate a table on a login node with `python -m
  app.services.fit_estimator.discovery --output
  config/infrastructures/<infra>/hardware.yaml` (`--probe` measures VRAM with a
  short `srun` per GPU type). `FIT_ESTIMATOR_HARDWARE_YAML` points at a
  specific file instead.
