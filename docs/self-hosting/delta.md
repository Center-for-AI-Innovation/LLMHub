# Delta & DeltaAI

Production LLMHub runs on the NCSA **Delta** and **DeltaAI** clusters'
service VMs — `dt-svc-llmaas01` and `dtai-svc-llmaas01`. The deployment kit
in [`infra/delta/`](https://github.com/Center-for-AI-Innovation/LLMHub/tree/main/infra/delta)
deploys the whole stack (PostgreSQL, backend, frontend) from a git ref,
with every runtime it needs fetched into the deployment tree, so nothing
depends on what the VM happens to have installed.

This page is an orientation; the kit's own
[`infra/delta/README.md`](https://github.com/Center-for-AI-Innovation/LLMHub/blob/main/infra/delta/README.md)
is the operating manual.

## The kit

```
infra/delta/
├── llmhub                        the CLI: preflight · deploy · start · stop ·
│                                 restart · status · smoke · logs
├── config/delta.env              shared non-secret config (paths, ports,
│                                 versions) — Delta's values, committed
├── config/cluster-deltaai.env    what differs on DeltaAI, committed
└── config/secrets.env.example    secret key names, no values — committed
```

The inference image is built separately per cluster (`devops/apptainers/`).

## Common commands

```bash
ssh dt-svc-llmaas01.delta.ncsa.illinois.edu
cd /path/to/LLMHub/infra/delta

./llmhub preflight --profile staging --ref main   # read-only checks
./llmhub deploy    --profile staging --ref main   # dry run: prints the plan
./llmhub deploy    --profile staging --ref main --apply
./llmhub smoke     --profile staging
./llmhub status
./llmhub logs backend -f
```

`deploy` re-fetches the recorded ref each time, so redeploying the latest
commit of a branch is just `./llmhub deploy --apply`.

## Profiles

| | production | dev | staging |
|---|---|---|---|
| Where | the production VM | `dt-svc-llmaas01` | either VM |
| Runs as | `svcdeltallmhub` only | `svcdeltallmhub` only | anyone in `delta_bfmz` |
| Ports (pg/backend/frontend) | 5433 / 8000 / 3000 | 5433 / 8000 / 3000 | 5533 / 8100 / 3100 |

`dev` and `production` are deliberately the same shape — the production VM
is not the first place production's configuration is ever exercised.
`staging` is a personal stack anyone on the team may run.

## Accessing a running instance

From your workstation, tunnel to the VM's frontend:

```bash
ssh -L 3000:localhost:3000 -L 8000:localhost:8000 \
  -o HostKeyAlgorithms=ecdsa-sha2-nistp256 \
  dt-svc-llmaas01.delta.ncsa.illinois.edu
# http://localhost:3000 (frontend)   http://localhost:8000/docs (backend)
```

## DeltaAI

The same kit deploys DeltaAI — source `config/cluster-deltaai.env` before
Delta's defaults. Differences (project paths, model cache locations, image)
are all in that one override file.

## Impersonation mode

On Delta, inference jobs can run **as the signed-in user** ("impersonate"
execution mode) rather than as the service account: LLMHub derives the
cluster username from the signed-in email, grants ACLs on that user's
workspace, and submits jobs through a wrapper. This keeps GPU-hours on the
user's own allocation. `./llmhub check-impersonation <user>` verifies a
user's setup, and `./llmhub launch-test` runs a real end-to-end inference
job.

For details — production deployment, the full command table, monitoring —
read `infra/delta/README.md` on the VM or in the repo.
