# Self-hosting

*This section is for people running LLMHub, not using it.*

The whole stack is in the
[LLMHub repository](https://github.com/Center-for-AI-Innovation/LLMHub). The
setup guides live next to the code they describe, so they stay accurate when
the code changes; this page points you to the right one.

## What the stack is

| Component | Role |
|---|---|
| **Next.js frontend** | Web UI, chat, sign-in (Better Auth with CILogon), and the API routes that proxy to running models. |
| **FastAPI backend** | Model catalog, launches through [vec-inf](https://github.com/VectorInstitute/vector-inference), logs, notifications. |
| **PostgreSQL** | Users, chats, the catalog and deployments. |
| **vLLM in an Apptainer image** | The model server, started by vec-inf inside Slurm jobs. |
| **A Slurm cluster** | The GPU nodes models run on. |

## Pick a guide

| You want to… | Guide |
|---|---|
| Develop LLMHub on your own machine | [Local development](https://github.com/Center-for-AI-Innovation/LLMHub/blob/main/README.md#local-development) in the README |
| Run the whole stack in Docker, with no Slurm | [Local Docker stack](https://github.com/Center-for-AI-Innovation/LLMHub/blob/main/infra/local/README.md) |
| Deploy on the Delta or DeltaAI service VMs | [Delta deployment kit](https://github.com/Center-for-AI-Innovation/LLMHub/blob/main/infra/delta/README.md) |
| Deploy on Magic Castle (Radiant) | [Magic Castle deployment guide](https://github.com/Center-for-AI-Innovation/LLMHub/blob/main/devops/magic_castle/DEPLOYMENT_GUIDE.md) |
| Build Radiant's vLLM image | [Apptainer build](https://github.com/Center-for-AI-Innovation/LLMHub/blob/main/infra/magic-castle/apptainers/README.md) |
| Run the backend's operator scripts (impersonation check, cache cleanup) | [Backend scripts](https://github.com/Center-for-AI-Innovation/LLMHub/blob/main/backend/scripts/README.md) |

## Configuration

Both apps read environment files. The checked-in examples,
[`backend/.env.example`](https://github.com/Center-for-AI-Innovation/LLMHub/blob/main/backend/.env.example)
and
[`frontend/.env.example`](https://github.com/Center-for-AI-Innovation/LLMHub/blob/main/frontend/.env.example),
are the reference for every variable. The Delta kit writes both files for
you.

Each cluster also has a directory under
[`backend/config/infrastructures/`](https://github.com/Center-for-AI-Innovation/LLMHub/tree/main/backend/config/infrastructures)
with its vec-inf environment (partitions, image, limits) and any model
catalog overrides. Supporting a new cluster means adding a directory there,
not changing the code.
