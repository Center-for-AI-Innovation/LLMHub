# Repository layout

```text
backend/                 FastAPI service
├── app/
│   ├── api/             route handlers
│   ├── services/        catalog, launches, model sync (model_service.py)
│   ├── utils/           infrastructure detection, vec-inf/llm inference
│   └── schemas/         pydantic models
├── config/
│   ├── models.yaml            default model catalog
│   └── infrastructures/       per-cluster overrides (delta, delta-ai-ncsa,
│                              magic-castle-radiant, campus-cluster)
├── scripts/             ops scripts (impersonation checks, cache eviction)
└── tests/

frontend/                Next.js application
├── app/
│   ├── (auth)/          sign-in
│   ├── (chat)/          chat pages
│   ├── (dashboard)/     model library, active models, profile
│   └── api/             route handlers: chat proxy, public API, models,
│                        deployments, slurm-accounts, share, api-keys
├── components/          UI components (chat, model cards, dialogs)
├── hooks/               react-query hooks (models, deployments, sharing…)
├── lib/                 auth, db (Drizzle), utils
└── tests/               unit (vitest), e2e/contrast (Playwright + axe)

devops/
├── apptainers/          vLLM .sif build scripts, per cluster
└── magic_castle/        Terraform + deployment guide for Radiant

infra/
├── delta/               deploy kit for the Delta / DeltaAI service VMs
└── magic-castle/        (build scripts referenced by the guide)

docs/                    this documentation site (Material for MkDocs)
overrides/               MkDocs theme overrides (font loading)
.github/workflows/       CI, docs publish, HF models check
```

## Where things happen

| You're looking for… | Go to… |
|---|---|
| The model catalog / launch configs | `backend/config/models.yaml`, `backend/config/infrastructures/*/models.yaml` |
| Launch orchestration | `backend/app/services/model_service.py`, `backend/app/utils/llm_inference.py` |
| Cluster detection / infra settings | `backend/app/utils/infrastructure.py` |
| Chat proxy & public API | `frontend/app/api/v1/…`, `frontend/app/api/public/…` |
| Auth (Better Auth, CILogon) | `frontend/lib/auth/` |
| DB schema (frontend) | `frontend/lib/db/schema.ts` + Drizzle migrations |
| Deployment sharing | `frontend/app/api/models/deployments/*/share/` |
| The docs site | `docs/`, `mkdocs.yml`, `.github/workflows/docs.yml` |
