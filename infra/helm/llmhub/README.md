# LLMHub Helm chart (draft)

Deploys the LLMHub stack on Kubernetes. It mirrors the services in
[`infra/local/compose.yaml`](../../local/compose.yaml) and the env contract that
[`infra/delta/llmhub`](../../delta/llmhub) renders into `backend/.env` and
`frontend/.env`.

| Component | Kind | Notes |
|---|---|---|
| `frontend` | Deployment + Service | Next.js; the only thing the Ingress exposes |
| `backend` | Deployment + Service | FastAPI; ClusterIP only (no auth of its own) |
| `migrate-<rev>` | Job | `pnpm db:migrate` from the frontend image, once per install/upgrade |
| `postgresql` | StatefulSet + PVC | optional (`postgresql.enabled`); else `externalDatabase` |
| `vllm` | Deployment + PVC | optional always-on chat model (`vllm.enabled`), needs a GPU node |
| app Secret | Secret | auth secret, API-key pepper, CILogon, S3, OpenAI keys |

```
infra/helm/llmhub/
├── Chart.yaml
├── values.yaml
└── templates/
    ├── _helpers.tpl            names, labels, DB URL assembly, wait-for-db init container
    ├── secret.yaml             app secrets (generated once, kept on uninstall)
    ├── postgresql-secret.yaml  bundled or external DB password
    ├── postgresql.yaml
    ├── migrate-job.yaml
    ├── backend.yaml            Service, Deployment, optional vec-inf ConfigMap
    ├── frontend.yaml
    ├── vllm.yaml
    ├── ingress.yaml
    ├── serviceaccount.yaml
    └── NOTES.txt
```

## Quick start

```bash
helm lint infra/helm/llmhub
helm template llmhub infra/helm/llmhub -f my-values.yaml | less
helm upgrade --install llmhub infra/helm/llmhub -n llmhub --create-namespace -f my-values.yaml
```

Minimal `my-values.yaml` for a cluster with an ingress controller:

```yaml
ingress:
  enabled: true
  className: nginx
  host: llmhub.example.edu
  tls:
    - secretName: llmhub-tls
      hosts: [llmhub.example.edu]
frontend:
  config:
    ALWAYS_ON_VLLM_BASE_URL: https://vllm.example.edu/v1
    ALWAYS_ON_VLLM_MODEL: Qwen/Qwen3.5-2B
```

## How configuration maps

- **Database URL.** Assembled in the pod from the password Secret via
  `$(LLMHUB_DB_PASSWORD)`, then exposed as `DATABASE_URL` (backend) and
  `POSTGRES_URL` (frontend, migrations). The password is never in a ConfigMap.
  It is inserted unencoded, so an external password must be URL-safe.
- **Public URL.** `publicUrl`, else the ingress host. Becomes `BETTER_AUTH_URL`,
  the backend's `FRONTEND_URL`, and a `BACKEND_CORS_ORIGINS` entry. The
  CILogon redirect URI is `<publicUrl>/api/auth/oauth2/callback/cilogon`.
- **Backend settings.** `backend.config` is one-to-one with
  `backend/app/config/config.py`; empty values are skipped. Set
  `INFRASTRUCTURE` explicitly — hostname auto-detection cannot work in a pod.
- **Secrets.** `BETTER_AUTH_SECRET`, `USER_API_KEY_PEPPER` (and the vLLM key
  when `vllm.enabled`) are generated on first install, then read back with
  `lookup` on every upgrade. The Secret has `helm.sh/resource-policy: keep`.
  Rotating the pepper invalidates every user API key. For shared environments
  set `secrets.existingSecret` and manage it outside Helm (same key names as
  the env vars).

## Open items before this is production-ready

1. **Production images don't exist yet.** The chart defaults to
   `ghcr.io/center-for-ai-innovation/llmhub-{backend,frontend}:<appVersion>`,
   which nothing publishes. `infra/local/frontend.Dockerfile` runs `next dev`
   and migrates on start, so it isn't suitable. We need a multi-stage frontend
   image (`next build` → `next start`, ideally `output: 'standalone'`) that
   still ships `lib/db/migrate.ts` + `tsx` for the migration Job, and a CI
   workflow to push both images. `NEXT_PUBLIC_*` values are inlined at build
   time, so they're build args, not chart values.
2. **Slurm reachability is the hard part.** The backend submits inference jobs
   through vec-inf (`sbatch`, `squeue`, `scancel`). In a pod that needs the
   Slurm client binaries in the backend image, `slurm.conf` and a munge key
   (via `backend.extraVolumes`/`extraVolumeMounts`), network access to
   `slurmctld`, and the shared filesystems the jobs write logs to
   (`VEC_INF_WORK_DIR`, `VEC_INF_LOG_DIR`) mounted at the same paths as on the
   compute nodes. An alternative is a small submit-host proxy that the backend
   calls. That's a design decision for whichever cluster we target first.
3. **Impersonate mode doesn't translate.** `VEC_INF_EXECUTION_MODE=impersonate`
   relies on `sudo -u svcllmhub<netid>` on the Delta VM. In Kubernetes, use
   `direct` unless a submit host provides the same edge.
4. **GPU pool seeding.** `infra/delta/llmhub start` seeds the backend's
   `ResourceAllocation` pool (`LLMHUB_GPU_POOL`). Launches with `num_gpus` are
   refused until it exists. This needs a post-install hook Job or a backend
   startup step.
5. **Backend replicas = 1.** The sync and expiry loops run in-process. Scaling
   out would duplicate them until they're leader-elected or split into a worker.
6. **Bundled PostgreSQL** is a single pod with no backups. Use `externalDatabase`
   (CloudNativePG, RDS, a campus DB) for anything that matters.
