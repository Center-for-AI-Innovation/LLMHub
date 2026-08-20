#!/bin/bash
# status.sh — what is deployed, what is running, and at what version.
# Read-only and safe to run as any account.
#
# Usage: ./status.sh [--profile staging|production]

export REQUIRE_SERVICE_USER=0
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

while [ $# -gt 0 ]; do
    case "$1" in
        --profile) export LLMHUB_PROFILE="$2"; shift 2 ;;
        -h|--help) sed -n '2,6p' "${BASH_SOURCE[0]}"; exit 0 ;;
        *) die "unknown argument: $1" ;;
    esac
done
export REQUIRE_SERVICE_USER=0

printf 'LLMHub status — profile %s on %s\n' \
    "${LLMHUB_PROFILE:-production}" "$(hostname -s 2>/dev/null)"
printf 'root: %s\n' "$LLMHUB_DEPLOY_ROOT"

step "Deployment"
if [ -d "${LLMHUB_SRC_DIR}/.git" ]; then
    desc="$(git -c safe.directory='*' -C "$LLMHUB_SRC_DIR" describe --tags --always 2>/dev/null || echo '?')"
    sha="$(git -c safe.directory='*' -C "$LLMHUB_SRC_DIR" rev-parse --short HEAD 2>/dev/null || echo '?')"
    dirty="$(git -c safe.directory='*' -C "$LLMHUB_SRC_DIR" status --porcelain 2>/dev/null | head -1)"
    if [ "$desc" = "$LLMHUB_REF" ]; then
        ok "source at ${desc} (${sha})"
    else
        warn "source at ${desc} (${sha}), configured ref is ${LLMHUB_REF}"
    fi
    [ -n "$dirty" ] && warn "working tree is DIRTY — not a reproducible deployment"
else
    warn "no source tree at ${LLMHUB_SRC_DIR}"
fi

if [ -x "${LLMHUB_VENV_DIR}/bin/python" ]; then
    ok "venv $("${LLMHUB_VENV_DIR}/bin/python" -V 2>&1)"
    v="$("${LLMHUB_VENV_DIR}/bin/python" -c 'import importlib.metadata as m; print(m.version("vec-inf"))' 2>/dev/null || echo none)"
    [ "$v" = "$LLMHUB_VEC_INF_VERSION" ] && ok "vec-inf ${v}" || warn "vec-inf ${v}, expected ${LLMHUB_VEC_INF_VERSION}"
else
    warn "no venv at ${LLMHUB_VENV_DIR}"
fi

step "Services"
if [ "$LLMHUB_PG_MODE" = "local" ]; then
    pg_running && ok "postgres listening on ${LLMHUB_PG_PORT}" || warn "postgres not running (${LLMHUB_PG_PORT})"
else
    info "external database mode"
fi

PIDF="${LLMHUB_RUN_DIR}/backend.pid"
if pidfile_alive "$PIDF"; then
    ok "backend running (pid $(cat "$PIDF"))"
else
    warn "backend not running"
fi

code="$(backend_health 8)"
[ "$code" = "200" ] && ok "GET /api/health -> 200" || warn "GET /api/health -> ${code}"

step "Recent log activity"
if [ -r "${LLMHUB_LOG_DIR}/backend.log" ]; then
    # grep -c prints a count AND exits 1 when the count is zero, so `|| echo 0`
    # would emit a second line. `|| true` is enough.
    errs="$(grep -cE ' - ERROR - ' "${LLMHUB_LOG_DIR}/backend.log" 2>/dev/null || true)"
    errs="${errs:-0}"
    [ "$errs" -eq 0 ] && ok "0 ERROR lines" || warn "${errs} ERROR line(s)"
    last="$(grep -oE 'Successfully synced [0-9]+ models' "${LLMHUB_LOG_DIR}/backend.log" 2>/dev/null | tail -1)"
    [ -n "$last" ] && ok "$last" || warn "no successful model sync recorded"
else
    warn "no backend log at ${LLMHUB_LOG_DIR}/backend.log"
fi
