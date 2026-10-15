# Self-hosting

LLMHub is self-hostable: the whole stack is in this repository, and it is
designed to run anywhere from a laptop to an HPC service VM to an
OpenStack-backed Magic Castle cluster.

## What the stack needs

| Component | Role |
|---|---|
| **Next.js frontend** | Web UI, chat, auth (Better Auth + CILogon), public/private API proxy routes. |
| **FastAPI backend** | Model catalog, launch orchestration, logs, database access. |
| **PostgreSQL** | Two schemas: one for the frontend (auth, chats), one for the backend (catalog, deployments). |
| **vLLM (Apptainer image)** | The inference server, launched by `vec-inf` inside Slurm jobs. |
| **Slurm cluster** | GPU nodes the deployments run on. |

Pick the deployment path that matches your situation:

- **[Local development](local-development.md)** — run frontend + backend +
  PostgreSQL on your machine, pointing at a cluster you have access to (or
  the local test mode).
- **[Delta & DeltaAI](delta.md)** — the production-style kit for the NCSA
  service VMs: one deploy script, config files, secrets template.
- **[Magic Castle (Radiant)](magic-castle.md)** — a full cluster on NCSA's
  OpenStack, with LLMHub running on the login node.
- **[Configuration reference](configuration.md)** — the environment
  variables the `.env.example` files expect.

## Inference images

vLLM runs inside an Apptainer container built per cluster, because the image
must match the cluster's paths, Python, and CUDA driver. The build scripts
live in `devops/apptainers/` (see the cluster-specific guides).

## Infrastructure configs

Cluster-specific behavior — partitions, accounts, GPU limits, image paths,
and the model catalog itself — lives in
`backend/config/infrastructures/<name>/`. LLMHub picks the config by
`INFRASTRUCTURE` environment variable, or by hostname pattern. Adding a new
cluster means adding a directory there, not forking the code.
