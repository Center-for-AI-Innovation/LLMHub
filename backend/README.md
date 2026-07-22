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

- Python 3.11+
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