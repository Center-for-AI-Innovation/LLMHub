# Magic Castle (Radiant)

The [Magic Castle](https://github.com/ComputeCanada/magic_castle)
deployment runs LLMHub on a small cluster built on NCSA's OpenStack cloud
(**Radiant**): a management/login pair plus two single-GPU A100 compute
nodes, with LLMHub itself on the login node.

The full walkthrough — cluster provisioning with Terraform through LLMHub
setup and systemd units — is the repo's
[`devops/magic_castle/DEPLOYMENT_GUIDE.md`](https://github.com/Center-for-AI-Innovation/LLMHub/blob/main/devops/magic_castle/DEPLOYMENT_GUIDE.md).
This page orients you; the guide is the manual.

## Cluster layout

| Instance | Flavor | Role |
|----------|--------|------|
| `mgmt1` | `gp.xlarge` | Puppet server, Slurm controller, FreeIPA, NFS |
| `login1` | `gp.xlarge` | Login node, LLMHub app (backend + frontend + PostgreSQL) |
| `node1` | `g1.a100.80gb.x1` | GPU compute node (1× A100 80 GB) |
| `node2` | `g1.a100.80gb.x1` | GPU compute node (1× A100 80 GB) |

## What's different from Delta

- **Everything on one node**: the backend runs on the login node (port
  8001 — 8000 is taken), the frontend on 3000, both under systemd as the
  `centos` user.
- **Infrastructure config**: `INFRASTRUCTURE=magic-castle-radiant` selects
  `backend/config/infrastructures/magic-castle-radiant/` — the `node`
  partition, account, GPU defaults, image paths, and its own model catalog.
- **One GPU per node**: because each compute node has a single A100,
  larger models run with **pipeline parallelism = 2** across both nodes
  (see [GPUs & cost](../deploying/gpu-resources.md)).
- **Apptainer from CVMFS**: the module system and vLLM image come from
  Compute Canada's CVMFS; the image is built on the cluster by
  `devops/apptainers/build_vllm_sif.sbatch`.

## Access

The Magic Castle is reached over SSH as the `centos` user on the login
node's public IP, or through an SSH tunnel:

```bash
ssh -L 3000:localhost:3000 -L 8001:localhost:8001 centos@<LOGIN_PUBLIC_IP>
# http://localhost:3000
```

Publishing the frontend at a public HTTPS URL is possible via the
cluster's Caddy reverse proxy (a `hieradata` block in `main.tf`), but off
by default while authentication and access control are being configured.

## Day-2 operations

- **Updating LLMHub**: `git pull` the checkout on the login node
  (`/project/def-sponsor00/centos/LLMHub`), rebuild the frontend if needed,
  and `sudo systemctl restart llmhub-backend llmhub-frontend`.
- **Job logs**: `~/.vec-inf-logs/<family>/<model>.<job-id>/` on the login
  node, or `scontrol show job <id>`.
- **Tearing down**: `terraform destroy` removes the whole cluster — the
  NFS volumes (with models and caches) go with it.
