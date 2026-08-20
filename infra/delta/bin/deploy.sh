#!/bin/bash
# deploy.sh — build an LLMHub deployment tree on Delta.
#
# DRY RUN BY DEFAULT: prints the plan and changes nothing. Pass --apply to act.
#
# Stages:
#   sync    clone/fetch LLMHub and check out the pinned tag, detached
#   tools   install uv, then create a venv on a standalone Python
#   backend install the backend into the venv, assert the vec-inf pin
#   render  write backend/.env from delta.env + secrets.env
#
# Database schema is NOT created here — see db-migrate.sh. Services are not
# started here — see start.sh.
#
# Usage:
#   ./deploy.sh [--apply] [--profile staging|production] [--ref vX.Y.Z]
#               [--recreate] [--stage sync|tools|backend|render|all]

# Resolve --profile / --ref BEFORE sourcing the config. delta.env self-defaults
# (VAR="${VAR:-...}"), so values are frozen on first source and a later
# re-source cannot change profile-derived ports or paths.
_prev=""
for _a in "$@"; do
    case "$_prev" in
        --profile) export LLMHUB_PROFILE="$_a" ;;
        --ref)     export LLMHUB_REF="$_a" ;;
    esac
    _prev="$_a"
done
unset _prev _a

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

APPLY=0
STAGE=all
RECREATE_VENV=0
while [ $# -gt 0 ]; do
    case "$1" in
        --apply)    APPLY=1; shift ;;
        --profile)  export LLMHUB_PROFILE="$2"; shift 2 ;;
        --ref)      export LLMHUB_REF="$2"; shift 2 ;;
        --stage)    STAGE="$2"; shift 2 ;;
        --recreate) RECREATE_VENV=1; shift ;;
        -h|--help) sed -n '2,18p' "${BASH_SOURCE[0]}"; exit 0 ;;
        *) die "unknown argument: $1" ;;
    esac
done

if [ "$APPLY" = "1" ]; then
    printf 'LLMHub deploy [APPLY — the deployment tree WILL be modified]\n'
else
    printf 'LLMHub deploy [DRY RUN — nothing changes; pass --apply to act]\n'
fi
printf 'ref: %s   profile: %s\nroot: %s\n' \
    "$LLMHUB_REF" "${LLMHUB_PROFILE:-production}" "$LLMHUB_DEPLOY_ROOT"

run() { printf '  $ %s\n' "$*"; if [ "$APPLY" = "1" ]; then "$@"; fi; }
staged() { [ "$STAGE" = "all" ] || [ "$STAGE" = "$1" ]; }

step "Guards"
require_service_user
reject_shared_tree
info "running as $(id -un)"
umask "$LLMHUB_UMASK"
info "umask ${LLMHUB_UMASK}"

# ---------------------------------------------------------------- 1. sync ----
if staged sync; then
step "Stage sync — source at ${LLMHUB_REF}"
run mkdir -p "$LLMHUB_DEPLOY_ROOT" "$LLMHUB_LOG_DIR" "$LLMHUB_RUN_DIR" "$LLMHUB_VEC_INF_WORK_DIR"

if [ -d "${LLMHUB_SRC_DIR}/.git" ]; then
    run git -C "$LLMHUB_SRC_DIR" fetch --tags --prune origin
else
    run git clone "$LLMHUB_REPO" "$LLMHUB_SRC_DIR"
fi
run git -C "$LLMHUB_SRC_DIR" checkout --detach "refs/tags/${LLMHUB_REF}"

if [ "$APPLY" = "1" ]; then
    [ -z "$(git -C "$LLMHUB_SRC_DIR" status --porcelain | head -1)" ] \
        || die "checkout is dirty after sync — a deployment must be a clean tree"
    ok "at $(git -C "$LLMHUB_SRC_DIR" describe --tags --always) ($(git -C "$LLMHUB_SRC_DIR" rev-parse --short HEAD))"
fi
fi

# --------------------------------------------------------------- 2. tools ----
if staged tools; then
step "Stage tools — uv + Python ${LLMHUB_PYTHON_VERSION}"
# The VM ships only Python 3.9, below the backend's >=3.10 floor, and has no
# uv/pnpm/node. Bootstrap uv with the system Python, then let uv fetch a
# standalone interpreter so the deployment owns its runtime.
if [ ! -x "${LLMHUB_UV_DIR}/bin/uv" ]; then
    run python3 -m venv "$LLMHUB_UV_DIR"
    run "${LLMHUB_UV_DIR}/bin/pip" install --quiet --upgrade pip
    run "${LLMHUB_UV_DIR}/bin/pip" install --quiet uv
else
    info "uv already present"
fi
export UV_CACHE_DIR="${LLMHUB_DEPLOY_ROOT}/.uvcache"
# `uv venv` refuses to overwrite an existing environment, so re-running deploy
# must skip it — otherwise every redeploy fails at this step. Use --recreate to
# rebuild the interpreter deliberately.
if [ -x "${LLMHUB_VENV_DIR}/bin/python" ] && [ "$RECREATE_VENV" != "1" ]; then
    info "venv already present: $("${LLMHUB_VENV_DIR}/bin/python" -V 2>&1) (pass --recreate to rebuild)"
else
    [ "$RECREATE_VENV" = "1" ] && info "recreating venv"
    run "${LLMHUB_UV_DIR}/bin/uv" venv ${RECREATE_VENV:+--clear} \
        --python "$LLMHUB_PYTHON_VERSION" "$LLMHUB_VENV_DIR"
fi
[ "$APPLY" = "1" ] && ok "venv python: $("${LLMHUB_VENV_DIR}/bin/python" -V 2>&1)"
fi

# ------------------------------------------------------------- 3. backend ----
if staged backend; then
step "Stage backend — install into the venv"
export UV_CACHE_DIR="${LLMHUB_DEPLOY_ROOT}/.uvcache" VIRTUAL_ENV="$LLMHUB_VENV_DIR"
run "${LLMHUB_UV_DIR}/bin/uv" pip install -e "${LLMHUB_SRC_DIR}/backend"

if [ "$APPLY" = "1" ]; then
    got="$("${LLMHUB_VENV_DIR}/bin/python" -c 'import importlib.metadata as m; print(m.version("vec-inf"))' 2>/dev/null || echo none)"
    if [ "$got" = "$LLMHUB_VEC_INF_VERSION" ]; then
        ok "vec-inf ${got} (pin satisfied)"
    else
        die "vec-inf is '${got}', expected ${LLMHUB_VEC_INF_VERSION}"
    fi
fi
fi

# -------------------------------------------------------------- 4. render ----
if staged render; then
step "Stage render — backend/.env"
load_secrets
BACKEND_ENV="${LLMHUB_SRC_DIR}/backend/.env"
DB_URL="$(database_url)"
info "writing ${BACKEND_ENV}"
info "database mode: ${LLMHUB_PG_MODE}"

if [ "$APPLY" = "1" ]; then
    {
        echo "# Generated by infra/delta/bin/deploy.sh — do not edit by hand."
        echo "# Regenerate instead: ./bin/deploy.sh --apply --stage render"
        echo "API_V1_STR=/api"
        echo "PROJECT_NAME=\"LLMHub Backend (${LLMHUB_PROFILE:-production} ${LLMHUB_REF})\""
        echo "BACKEND_CORS_ORIGINS=[\"http://localhost:${LLMHUB_FRONTEND_PORT}\",\"http://localhost:${LLMHUB_BACKEND_PORT}\"]"
        echo "DATABASE_URL=${DB_URL}"
        echo "SLURM_ACCOUNT=\"${LLMHUB_SLURM_ACCOUNT}\""
        echo "VEC_INF_ACCOUNT=\"${LLMHUB_SLURM_ACCOUNT}\""
        echo "VEC_INF_WORK_DIR=\"${LLMHUB_VEC_INF_WORK_DIR}\""
        echo "VEC_INF_ENV=\"${LLMHUB_VEC_INF_ENV}\""
        [ -n "$LLMHUB_VEC_INF_CONFIG_DIR" ] && echo "VEC_INF_CONFIG_DIR=${LLMHUB_VEC_INF_CONFIG_DIR}"
        # The backend's Settings model FORBIDS unknown keys, so writing a key
        # the deployed version does not define is not merely inert — it aborts
        # startup with 'Extra inputs are not permitted'. VEC_INF_LOG_DIR and the
        # impersonation keys all arrive together with PR #40/#49 and are absent
        # from config.py at v0.1.1, so they are gated behind an explicit mode.
        if [ -n "$LLMHUB_EXECUTION_MODE" ]; then
            echo "VEC_INF_EXECUTION_MODE=${LLMHUB_EXECUTION_MODE}"
            echo "VEC_INF_SHARED_WORK_ROOT=${LLMHUB_SHARED_WORK_ROOT}"
            [ -n "$LLMHUB_VEC_INF_LOG_DIR" ]   && echo "VEC_INF_LOG_DIR=\"${LLMHUB_VEC_INF_LOG_DIR}\""
            [ -n "$LLMHUB_IMPERSONATE_SCRIPT" ] && echo "VEC_INF_IMPERSONATE_SCRIPT=${LLMHUB_IMPERSONATE_SCRIPT}"
            [ -n "$LLMHUB_IMPERSONATE_PYTHON" ] && echo "VEC_INF_IMPERSONATE_PYTHON=${LLMHUB_IMPERSONATE_PYTHON}"
            [ -n "$LLMHUB_ACCOUNTS_SCRIPT" ]    && echo "VEC_INF_ACCOUNTS_SCRIPT=${LLMHUB_ACCOUNTS_SCRIPT}"
        fi
        echo "SYNC_INTERVAL=${LLMHUB_SYNC_INTERVAL:-60}"
        echo "EXPIRY_CHECK_INTERVAL=${LLMHUB_EXPIRY_CHECK_INTERVAL:-3000}"
        echo "MAX_DEPLOYMENTS_PER_CYCLE=${LLMHUB_MAX_DEPLOYMENTS_PER_CYCLE:-10}"
        # SMTP_PORT is typed int: an empty value fails validation rather than
        # being treated as unset, so omit the block entirely when unconfigured.
        if [ -n "$SMTP_HOST" ]; then
            echo "SMTP_HOST=${SMTP_HOST}"
            echo "SMTP_PORT=${SMTP_PORT:-25}"
            echo "SMTP_FROM=${SMTP_FROM}"
        fi
    } > "$BACKEND_ENV"
    chmod 0640 "$BACKEND_ENV"
    ok "wrote $(grep -cE '^[A-Z_]+=' "$BACKEND_ENV") keys"
fi
fi

printf '\n'
if [ "$APPLY" = "1" ]; then
    printf 'Done. Next:\n  ./bin/db-migrate.sh --apply   # create the schema\n  ./bin/start.sh                # start postgres + backend\n'
else
    printf 'Dry run complete. Nothing changed.\n'
fi
