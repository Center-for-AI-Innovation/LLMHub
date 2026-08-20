# LLMHub on NCSA Delta

Deployment tooling for running LLMHub on the Delta service VM
`dt-svc-llmaas01.delta.ncsa.illinois.edu`.

This replaces the ad-hoc scripts that previously lived outside version control
under the service account (`/projects/bfmz/svcdeltallmhub/Delta-deployment`).
Those targeted the pre-monorepo two-repo layout (`llm-serving-backend` +
`llm-serving-frontend`) and cannot deploy a current release.

## Layout

```
infra/delta/
├── config/
│   ├── delta.env             non-secret site config — committed
│   └── secrets.env.example   secret key names, no values — committed
└── bin/
    ├── common.sh             shared helpers (sourced, not run)
    ├── preflight.sh          read-only verification; safe as any account
    ├── deploy.sh             sync → tools → backend → render (dry-run default)
    ├── db-migrate.sh         create the schema without node (dry-run default)
    ├── start.sh              start postgres + backend
    ├── stop.sh               stop them
    ├── status.sh             what is deployed and running
    ├── smoke-test.sh         exercise a running backend for functionality
    └── build-vllm-sif.sbatch rebuild the vLLM image (SLURM, CPU partition)
```

## Quick start

```bash
cd infra/delta

# 1. Verify. Read-only, safe from a login node as yourself.
./bin/preflight.sh --profile staging --verbose

# 2. As the service user on the VM:
/sw/admin/scripts/impersonate svcdeltallmhub

./bin/deploy.sh     --apply --profile staging   # source + venv + config
./bin/start.sh             --profile staging    # postgres + backend
./bin/db-migrate.sh --apply --profile staging   # schema
./bin/start.sh             --profile staging    # restart so model sync runs

./bin/status.sh            --profile staging
```

`deploy.sh` and `db-migrate.sh` are **dry runs unless given `--apply`**.

## Testing a running backend

```bash
./bin/smoke-test.sh                      # production ports
./bin/smoke-test.sh --profile staging    # a test stack on the +100 block
./bin/smoke-test.sh --with-sync          # also exercise the DB write path
```

Every check is a GET by default, so it is safe against a live deployment. It
covers liveness, the OpenAPI surface, the model catalogue (which exercises the
database read path), deployments, requests and resources, and the backend log.

`--with-sync` adds `POST /api/models/sync`, which rewrites the model catalogue
in the database — idempotent, but a write.

**Inference is deliberately not covered.** `POST /api/models/deployments`
submits a real SLURM job and depends on a current `/sw/llmhub/vllm.sif`; that
belongs in a deliberate test, not a smoke test.

## Profiles

`--profile staging` shifts every port by +100 so a staging stack runs beside
production on one VM:

| | production | staging |
|---|---|---|
| PostgreSQL | 5433 | 5533 |
| backend | 8000 | 8100 |
| frontend | 3000 | 3100 |

## Things about Delta that the scripts encode

These are not stylistic choices; each one is a constraint that breaks the
deployment if ignored.

**`/projects` is Lustre and mounted `nodev`.** PostgreSQL data directories and
the Apptainer cache cannot live there. Both are placed under `/var/tmp`.

**The VM has no `uv`, `pnpm`, `node`, or `psql`, and system Python is 3.9** —
below the backend's `>=3.10` floor. `deploy.sh` bootstraps `uv` with the system
Python, then has `uv` fetch a standalone CPython so the deployment owns its
runtime rather than depending on a conda env somebody else maintains.

**The database schema is owned by the frontend.** The backend reads tables that
Drizzle creates. Deploying the backend alone against an empty database starts
cleanly but fails every model sync with:

```
(psycopg2.errors.UndefinedTable) relation "AvailableModel" does not exist
```

`pnpm db:migrate` is the upstream path, but it needs node. Drizzle emits plain
`.sql` files, so `db-migrate.sh` applies them with `psql` inside the postgres
container instead.

**`VEC_INF_CONFIG_DIR` is ignored at v0.1.1.** `backend/app/main.py`
unconditionally overwrites it with the auto-detected in-repo infrastructure
directory. Detection resolves to `delta` correctly on this VM. Setting the
variable in `.env` has no effect until that changes.

**SSH host trust is centrally managed.** `/etc/ssh/ssh_config` sets
`StrictHostKeyChecking yes` and `UserKnownHostsFile /dev/null` for `dt-svc*`,
so the only trust anchor is `/etc/ssh/ssh_known_hosts` and you cannot add a
personal exception. The `ed25519` entry for this VM is stale (the VM was
re-imaged 2026-06-02); the `ecdsa` entry is current. Pinning ecdsa verifies
against the site file **without weakening checking**:

```bash
ssh -o HostKeyAlgorithms=ecdsa-sha2-nistp256 dt-svc-llmaas01.delta.ncsa.illinois.edu
```

Do not reach for `StrictHostKeyChecking=no`. The stale entry is a site
bookkeeping issue and wants an admin fix.

## The vLLM container image

`config/infrastructures/delta/environment.yaml` points inference at
`/sw/llmhub/vllm.sif`. Rebuild it with:

```bash
sbatch infra/delta/bin/build-vllm-sif.sbatch
# or a different tag:
IMAGE_TAG=v0.19.1 sbatch infra/delta/bin/build-vllm-sif.sbatch /path/to/out.sif
```

This is the Delta counterpart to `devops/apptainers/build_vllm_sif.sbatch`,
which is written for Magic Castle Radiant and **does not run here**. The
differences are not cosmetic:

| Magic Castle version | Delta version | Why |
|---|---|---|
| `--fakeroot` | no fakeroot | Delta has no subuid/subgid mapping for ordinary users; `--fakeroot` fails outright. Apptainer 1.5 converts OCI → SIF unprivileged. |
| sandbox → SIF round-trip | direct build | The sandbox step dodged NFS xattr limits. Node-local disk here has no such limit. |
| `module load apptainer` | none | It is `/usr/bin/apptainer` on Delta. |
| `-p node` | `-p cpu`, `--account=…-delta-cpu` | The build uses no GPU; a GPU partition would idle an A100. |
| cache on `/project` | cache on node-local disk | ~10 GB of layers onto Lustre is slow, and `/projects` runs near quota. |

The job builds and verifies locally, then copies the finished image to the
output path — it never writes a partial 20 GB file to the destination.

**Installing it is a separate, privileged step.** The job prints the exact
commands; the existing image is renamed to a dated `.bak` rather than deleted,
so a bad image can be rolled back.

## Per-user impersonation

The Delta deployment is moving to running inference jobs as `svcllmhub<netid>`
rather than all as the service account, via these settings:

```
VEC_INF_EXECUTION_MODE, VEC_INF_SHARED_WORK_ROOT,
VEC_INF_IMPERSONATE_SCRIPT, VEC_INF_IMPERSONATE_PYTHON,
VEC_INF_ACCOUNTS_SCRIPT
```

**None of these exist in `backend/app/config/config.py` at v0.1.1.** They arrive
with PR #40 and its follow-up #49. Setting them on v0.1.1 is inert, so
`deploy.sh` omits them unless `LLMHUB_EXECUTION_MODE` is set explicitly. Once
those land in a release, set it in `config/delta.env` and re-render.

## Frontend

Not yet automated. It needs node and pnpm, which the VM does not provide, plus
CILogon OAuth credentials and S3 configuration. Deciding how to provision node
(nvm under the service account, or an Apptainer image) is the open item; until
then `db-migrate.sh` covers the schema half of what the frontend would have
done.

## Troubleshooting

**Backend starts but every model sync fails** — the schema is missing. Run
`db-migrate.sh --apply`, then restart the backend.

**`Permission denied` creating the deployment root** — `ls` shows the ACL
*mask* in the group field, which is misleading. Check the real entry:

```bash
getfacl /projects/bfmz/svcdeltallmhub    # look at 'group::', not the ls output
```

**Apptainer fails with `squashfuse_ll exited`** — corrupted image cache:

```bash
rm -rf /var/tmp/llmhub-apptainer-cache-$USER && apptainer cache clean -f
```

**Port held with no pidfile** — `stop.sh` deliberately refuses to kill by port
alone; on a shared VM that process may not be yours. Identify it first:

```bash
ss -ltnp | grep 8100
```
