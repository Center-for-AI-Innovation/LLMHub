# Local Docker stack

This Compose project runs LLMHub without Slurm: the Next.js frontend, FastAPI
backend, PostgreSQL, and an OpenAI-compatible vLLM server using
`Qwen/Qwen3.5-2B`. Qwen runs in text-only mode so its vision encoder does not
consume the memory needed by the rest of the development stack.

## Start

Docker Desktop should have at least 12 GB of memory available. The first start
downloads the vLLM image and model weights, so it can take several minutes.

```bash
cd infra/local
cp .env.example .env
docker compose up --build --wait
```

Open the frontend at <http://localhost:3000>. The backend API is available at
<http://localhost:8000/docs>, and vLLM's OpenAI-compatible API is exposed at
<http://localhost:8001/v1>.

Local email/password authentication is enabled when CILogon variables are not
set. The frontend uses its local deployment routes, so launching the displayed
model does not submit a Slurm job.

Verify text generation directly:

```bash
curl http://localhost:8001/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"Qwen/Qwen3.5-2B","messages":[{"role":"user","content":"Reply with: local stack works"}],"max_tokens":16}'
```

Stop the stack while preserving database and model caches:

```bash
docker compose down
```

Use `docker compose down --volumes` to also remove those caches.

## Other hosts

The default vLLM image targets ARM64 CPU hosts such as Apple Silicon. On an
NVIDIA Linux host, set `VLLM_IMAGE=vllm/vllm-openai:latest` and add the GPU
device reservation supported by that Docker installation. vLLM image, model,
context length, dtype, ports, and PostgreSQL credentials can all be overridden
in `.env`. `VLLM_MEMORY_UTILIZATION` controls the fraction of container memory
reserved by vLLM's CPU backend (despite the upstream flag being named
`--gpu-memory-utilization`).
