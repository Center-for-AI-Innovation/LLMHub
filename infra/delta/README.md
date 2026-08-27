# LLMHub on NCSA Delta

Deployment kit for the Delta service VM `dt-svc-llmaas01.delta.ncsa.illinois.edu`:
one script, one config file, one secrets template.

```
infra/delta/
├── llmhub                      the CLI: preflight · deploy · start · stop · restart · status · smoke · logs
├── config/delta.env            non-secret site config (paths, ports, versions) — committed
├── config/secrets.env.example  secret key names, no values — committed
└── build-vllm-sif.sbatch       rebuild the inference image on the cluster (see below)
```

It deploys the **whole stack** — PostgreSQL (Apptainer), the FastAPI backend
(uvicorn) and the Next.js frontend — from a git ref, with every runtime it
needs (uv-managed CPython, Node, pnpm) fetched into the deployment tree, so
nothing depends on what the VM happens to have installed.

## Quick start

```bash
ssh -o HostKeyAlgorithms=ecdsa-sha2-nistp256 dt-svc-llmaas01.delta.ncsa.illinois.edu
cd /path/to/LLMHub/infra/delta

# A personal staging stack (ports 5533/8100/3100), tracking a branch:
./llmhub preflight --profile staging --ref port/backend-pr-32
./llmhub deploy    --profile staging --ref port/backend-pr-32           # dry run: prints the plan
./llmhub deploy    --profile staging --ref port/backend-pr-32 --apply   # ~10 min first time
./llmhub smoke     --profile staging

# Production (ports 5433/8000/3000) runs as the service user and pins a tag:
/sw/admin/scripts/impersonate svcdeltallmhub
./llmhub deploy --apply --ref v0.1.1
```

Then from your workstation:

```bash
ssh -L 3100:localhost:3100 -L 8100:localhost:8100 -o HostKeyAlgorithms=ecdsa-sha2-nistp256 dt-svc-llmaas01.delta.ncsa.illinois.edu
# http://localhost:3100   (frontend)    http://localhost:8100/docs   (backend)
```

`deploy` is a dry run unless given `--apply`. It re-fetches the recorded ref
each time, so **redeploying the latest commit of a branch is just
`./llmhub deploy --apply`** — the ref and SHA that were deployed are kept in
`$LLMHUB_DEPLOY_ROOT/DEPLOYED` and shown by `status`.

| Command | Does |
|---|---|
| `preflight` | Read-only checks (identity, tools, ref, filesystems, network, ports, image, secrets). Safe as any account, from a login node or the VM. |
| `deploy [--apply]` | Clone/fetch and check out the ref (detached) → fetch runtimes → install backend + frontend deps → start PostgreSQL → write `backend/.env` and `frontend/.env` → Drizzle migrations + `next build` → (re)start. `--recreate` rebuilds the venv and node. |
| `start` / `stop [--all]` / `restart` | `stop` leaves PostgreSQL running unless `--all`. Pidfiles are written by the daemons themselves; a pidfile-less process on one of our ports is stopped or adopted only if its cwd is inside this deployment — never someone else's process. |
| `status` | What is deployed (ref, SHA, clean?), runtimes, what is running, health, log error counts. |
| `smoke [--with-sync]` | GETs against both services; `--with-sync` also exercises the catalogue write path. Never launches inference. |
| `launch-test [--keep]` | One real inference job through the backend API: creates/uses a local test user, POSTs a deployment for `LLMHUB_TEST_MODEL` (`LLMHUB_TEST_GPUS` GPUs, tensor-parallel), waits for the server, runs a chat completion against the vLLM endpoint, then shuts it down (`--keep` leaves it running for a frontend session). Submits a SLURM job as the account running the backend. |
| `logs <name> [-f]` | Tail a log (`backend`, `frontend`, `postgres`, `build`, `launch-test`, …). |

## Profiles and where things live

| | production | staging |
|---|---|---|
| ports pg / backend / frontend | 5433 / 8000 / 3000 | 5533 / 8100 / 3100 |
| runs as | `svcdeltallmhub` only | anyone in `delta_bfmz` |
| deploy root (`/projects`, Lustre) | `/projects/bfmz/svcdeltallmhub/llmhub-production` | `/projects/bfmz/$USER/llmhub-staging` |
| local root (`/data`, xfs) | `/data/llmhub/production` | `/data/llmhub/staging` |
| ref | a release tag | usually a branch |

Deploy root: source checkout, venv, node, logs, pidfiles, `secrets.env`,
`DEPLOYED`. Local root: PostgreSQL data + password, the postgres image,
Apptainer cache. Both survive a VM reboot; after one, run `./llmhub start`.

## Things about Delta the script encodes

Each of these broke a deployment when ignored.

- **`apptainer pull` is run with `APPTAINER_IGNORE_PROOT=1`.** Delta's apptainer
  1.5.1 has no suid helper and no subuid range, so it wraps the OCI→SIF
  conversion in proot, and proot-wrapped `mksquashfs` segfaults (exit 139) —
  on the 150 MB postgres image here as on the 22 GB vLLM image on the cluster.
  Pulling needs no root emulation.
- **`/projects` is Lustre, mounted `nodev`** — PostgreSQL and Apptainer will
  not run from it. **`/var/tmp` is tmpfs** — the 2026-08-20 staging database
  lived there and was gone after the 2026-08-25 reboot. **`/tmp` is 4 G.**
  `/data` (150 G xfs, `svcdeltallmhub:delta_bfmz` 0770) is the only durable
  local disk; `preflight` refuses a tmpfs local root.
- **The VM has Python 3.9 and no `uv`, `node`, `pnpm`, `psql`.** The backend
  needs ≥3.10 and the frontend needs Node ≥20.9. `deploy` bootstraps `uv`
  with the system Python, lets it fetch CPython, downloads the Node tarball
  (checksum-verified) and installs pnpm into it. Versions are pinned in
  `delta.env`. Every cache is kept out of `$HOME` (NFS, quota).
- **The backend's `Settings` forbids unknown keys** — a key the deployed
  version does not define aborts startup (`Extra inputs are not permitted`).
  `deploy` writes only keys present in that checkout's `config.py`, so one
  config serves v0.1.1 and the impersonation branch alike.
- **The schema belongs to the frontend.** Drizzle migrations create the tables
  the backend reads; `pnpm build` runs them, which is why PostgreSQL is
  started before the build and why the build is part of `deploy`.
- **SSH host trust is central.** `/etc/ssh/ssh_config` pins `dt-svc*` to
  `/etc/ssh/ssh_known_hosts` with no personal exceptions; the ed25519 entry
  for this VM is stale (re-imaged 2026-06-02), the ecdsa one is current.
  `-o HostKeyAlgorithms=ecdsa-sha2-nistp256` verifies against the site file
  without weakening checking. Never use `StrictHostKeyChecking=no`.
- **Access is loopback + SSH tunnel.** Nothing binds `0.0.0.0`. A public
  hostname needs a reverse proxy in front of the VM; `/data` already holds a
  certificate for `llmhub-dev.delta.ncsa.illinois.edu`, but no proxy is
  configured.
- **Nothing restarts after a reboot.** `crontab` is PAM-denied for ordinary
  users and user services do not linger; after a VM reboot someone runs
  `./llmhub start` (state on `/data` and `/projects` is intact). Set `LLMHUB_PUBLIC_URL` to the public origin when that lands —
  it is baked into the frontend build and into the CILogon redirect URI.

## Inference config and `local.env`

`deploy` renders `backend/config/infrastructures/delta/environment.yaml` into
`$LLMHUB_DEPLOY_ROOT/vec-inf-config/` (image path, partition, GRES type, time,
HF-cache bind, log dir — all from `delta.env`) and points the backend at it via
`VEC_INF_CONFIG_DIR`. So a staging stack can run a different vLLM image or
partition without editing the checkout or touching `/sw/llmhub`.

Per-stack overrides go in `$LLMHUB_DEPLOY_ROOT/local.env`, sourced after
`delta.env` — leaf values only (an image path, a partition), e.g.:

```bash
LLMHUB_VLLM_SIF=/projects/bfmz/dadams/llmhub-containers/vllm-v0.19.1-slingshot-v2.sif
```

## Secrets

`deploy` creates `$LLMHUB_SECRETS_FILE` (default `$LLMHUB_DEPLOY_ROOT/secrets.env`,
mode 0600) from `config/secrets.env.example` on first run, generating
`BETTER_AUTH_SECRET` and `USER_API_KEY_PEPPER`. Everything else — CILogon
client, always-on vLLM endpoint, S3 — is filled in by hand, then `deploy
--apply` again. Without CILogon the frontend runs with local accounts, which
is fine for staging. Keep the pepper stable: rotating it invalidates every
user API key.

## Inference jobs and the vLLM image

`smoke` never launches a model. `POST /api/models/deployments` submits a real
SLURM job as the account running the backend (`VEC_INF_EXECUTION_MODE=direct`)
or as `svcllmhub<netid>` (`impersonate`, service user only, PR #40) using
`/sw/llmhub/vllm.sif`. That image is what
`backend/config/infrastructures/delta/environment.yaml` names; rebuilding it
is a cluster job, not a VM step — `build-vllm-sif.sbatch` documents why the
one-shot `apptainer build` fails on Delta (proot + mksquashfs) and points at
the two-step build that works.

## Troubleshooting

- **`deploy` fails in the build step** — `./llmhub logs build`. The usual cause
  is the database: `./llmhub status` should show postgres up.
- **Backend starts, every model sync fails with `relation "AvailableModel"
  does not exist`** — migrations did not run; `./llmhub deploy --apply`.
- **`Permission denied` creating the deploy root under the service user's
  directory** — `ls` shows the ACL *mask* in the group column;
  `getfacl` shows the real `group::` entry. The root has to be created by
  `svcdeltallmhub` once.
- **Port held, no pidfile** — someone else's process. `ss -ltnp | grep <port>`.
- **Apptainer `squashfuse_ll exited` / image errors** — `rm -rf
  /data/llmhub/<profile>/apptainer/cache` and rerun.
