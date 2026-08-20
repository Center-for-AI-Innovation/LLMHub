#!/bin/bash
# common.sh — shared helpers for the Delta deployment scripts.
# Sourced, never executed directly.
#
# `set -eo pipefail` WITHOUT -u: several helpers pipe into `head`/`grep`, and
# SIGPIPE (exit 141) aborts the script under `set -euo pipefail`.

set -eo pipefail

INFRA_BIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "${INFRA_BIN_DIR}/.." && pwd)"

# shellcheck disable=SC1091
. "${INFRA_DIR}/config/delta.env"

# ------------------------------------------------------------------ output ---
_c() { [ -t 1 ] && printf '\033[%sm' "$1" || true; }
ok()   { _c 32; printf '  PASS'; _c 0; printf '  %s\n' "$*"; }
warn() { _c 33; printf '  WARN'; _c 0; printf '  %s\n' "$*"; }
bad()  { _c 31; printf '  FAIL'; _c 0; printf '  %s\n' "$*"; }
step() { printf '\n'; _c 1; printf '==> %s' "$*"; _c 0; printf '\n'; }
info() { printf '  %s\n' "$*"; }
die()  { _c 31; printf 'ERROR: '; _c 0; printf '%s\n' "$*" >&2; exit 1; }

# ------------------------------------------------------------------ guards ---
require_service_user() {
    if [ "${REQUIRE_SERVICE_USER}" = "1" ] && [ "$(id -un)" != "$LLMHUB_SERVICE_USER" ]; then
        die "must run as ${LLMHUB_SERVICE_USER}.
       Use: /sw/admin/scripts/impersonate ${LLMHUB_SERVICE_USER}
       For a personal staging stack that touches nothing shared:
         REQUIRE_SERVICE_USER=0 LLMHUB_PROFILE=staging $0 ..."
    fi
}

# A deployment tree must never share a directory with a developer working copy.
reject_shared_tree() {
    case "$LLMHUB_DEPLOY_ROOT" in
        */Delta-deployment|*/Delta-deployment/*)
            die "LLMHUB_DEPLOY_ROOT is inside Delta-deployment, which holds the retired
       pre-monorepo stack and developer working copies. Pick a dedicated path." ;;
    esac
}

# --------------------------------------------------------------- apptainer ---
apptainer_env() {
    export APPTAINER_CACHEDIR="$LLMHUB_APPTAINER_CACHEDIR"
    export APPTAINER_TMPDIR="$LLMHUB_APPTAINER_TMPDIR"
    mkdir -p "$APPTAINER_CACHEDIR" "$APPTAINER_TMPDIR"
}

# psql inside the postgres image, talking over the unix socket.
pg_psql() {
    apptainer_env
    apptainer exec --bind "${LLMHUB_PG_ROOT}:/pgroot" "$LLMHUB_PG_IMAGE" \
        psql -h /pgroot -p "$LLMHUB_PG_PORT" -U "$LLMHUB_PG_USER" "$@"
}

pg_running() {
    [ -S "${LLMHUB_PG_ROOT}/.s.PGSQL.${LLMHUB_PG_PORT}" ]
}

# --------------------------------------------------------------- database ----
# Local mode talks over the unix socket, which avoids needing a password.
database_url() {
    if [ "$LLMHUB_PG_MODE" = "external" ]; then
        [ -n "$LLMHUB_DATABASE_URL" ] || die "LLMHUB_PG_MODE=external but LLMHUB_DATABASE_URL is unset (put it in secrets.env)"
        printf '%s' "$LLMHUB_DATABASE_URL"
    else
        printf 'postgresql://%s@localhost:%s/%s?host=%s' \
            "$LLMHUB_PG_USER" "$LLMHUB_PG_PORT" "$LLMHUB_PG_DB" "$LLMHUB_PG_ROOT"
    fi
}

# ------------------------------------------------------------------ process --
port_listener() {  # port -> pid, or empty
    if command -v ss >/dev/null 2>&1; then
        ss -ltnp 2>/dev/null | awk -v p=":$1\$" '$4 ~ p' | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2
    else
        lsof -ti ":$1" -sTCP:LISTEN 2>/dev/null | head -1
    fi
}

port_in_use() { [ -n "$(port_listener "$1")" ]; }

pidfile_alive() {  # path -> 0 if a live pid
    [ -f "$1" ] || return 1
    local p; p="$(cat "$1" 2>/dev/null)"
    [ -n "$p" ] && kill -0 "$p" 2>/dev/null
}

# The backend answers on /api/health; FastAPI 307s the un-slashed form, so
# always follow redirects.
backend_health() {
    curl -sL -o /dev/null -w '%{http_code}' --max-time "${1:-10}" \
        "http://${LLMHUB_BIND_HOST}:${LLMHUB_BACKEND_PORT}/api/health" 2>/dev/null || echo 000
}

load_secrets() {
    if [ -r "$LLMHUB_SECRETS_FILE" ]; then
        local mode; mode="$(stat -c '%a' "$LLMHUB_SECRETS_FILE" 2>/dev/null || echo '?')"
        [ "$mode" = "600" ] || warn "secrets file is mode ${mode}; should be 0600"
        # shellcheck disable=SC1090
        . "$LLMHUB_SECRETS_FILE"
    fi
}
