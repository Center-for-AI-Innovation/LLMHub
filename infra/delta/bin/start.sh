#!/bin/bash
# start.sh — start the LLMHub services on Delta.
#
# Starts, in order:
#   1. PostgreSQL   (Apptainer, local mode only)  — data under /var/tmp
#   2. Backend      (uvicorn)                      — bound to 127.0.0.1
#
# The frontend is not started here: it needs node/pnpm, which the Delta VM
# does not currently provide. See README, "Frontend".
#
# Usage: ./start.sh [--profile staging|production] [--no-postgres]

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

WITH_PG=1
while [ $# -gt 0 ]; do
    case "$1" in
        --profile)     export LLMHUB_PROFILE="$2"; shift 2 ;;
        --no-postgres) WITH_PG=0; shift ;;
        -h|--help)     sed -n '2,13p' "${BASH_SOURCE[0]}"; exit 0 ;;
        *) die "unknown argument: $1" ;;
    esac
done

printf 'LLMHub start — profile %s, ports pg=%s backend=%s\n' \
    "${LLMHUB_PROFILE:-production}" "$LLMHUB_PG_PORT" "$LLMHUB_BACKEND_PORT"

step "Guards"
require_service_user
umask "$LLMHUB_UMASK"
[ -x "${LLMHUB_VENV_DIR}/bin/uvicorn" ] || die "no venv at ${LLMHUB_VENV_DIR} — run ./bin/deploy.sh --apply first"
[ -r "${LLMHUB_SRC_DIR}/backend/.env" ] || die "no backend/.env — run ./bin/deploy.sh --apply --stage render"
mkdir -p "$LLMHUB_LOG_DIR" "$LLMHUB_RUN_DIR"
ok "prerequisites present"

# ------------------------------------------------------------- postgres -----
if [ "$WITH_PG" = "1" ] && [ "$LLMHUB_PG_MODE" = "local" ]; then
step "PostgreSQL"
apptainer_env
mkdir -p "$LLMHUB_PG_ROOT"

if pg_running; then
    ok "already running on ${LLMHUB_PG_PORT}"
else
    if [ ! -f "${LLMHUB_PG_ROOT}/data/PG_VERSION" ]; then
        info "initialising cluster at ${LLMHUB_PG_ROOT}/data"
        # /projects is Lustre and nodev; the data directory must be local.
        apptainer exec --bind "${LLMHUB_PG_ROOT}:/pgroot" "$LLMHUB_PG_IMAGE" \
            initdb -D /pgroot/data -U "$LLMHUB_PG_USER" >/dev/null 2>&1 \
            || die "initdb failed"
        {
            echo "port = ${LLMHUB_PG_PORT}"
            echo "unix_socket_directories = '${LLMHUB_PG_ROOT}'"
            echo "listen_addresses = 'localhost'"
        } >> "${LLMHUB_PG_ROOT}/data/postgresql.conf"
        ok "cluster initialised"
    fi

    # setsid + nohup so the server survives the launching shell (and ssh).
    setsid nohup apptainer exec --bind "${LLMHUB_PG_ROOT}:/pgroot" "$LLMHUB_PG_IMAGE" \
        postgres -D /pgroot/data >> "${LLMHUB_LOG_DIR}/postgres.log" 2>&1 < /dev/null &

    for _ in $(seq 1 30); do pg_running && break; sleep 1; done
    pg_running || die "PostgreSQL did not come up — see ${LLMHUB_LOG_DIR}/postgres.log"
    ok "started on ${LLMHUB_PG_PORT}"
fi

if ! pg_psql -tAc "SELECT 1 FROM pg_database WHERE datname='${LLMHUB_PG_DB}'" 2>/dev/null | grep -q 1; then
    pg_psql -q -c "CREATE DATABASE ${LLMHUB_PG_DB}" >/dev/null 2>&1 || true
    ok "created database ${LLMHUB_PG_DB}"
fi
fi

# --------------------------------------------------------------- backend ----
step "Backend"
PIDF="${LLMHUB_RUN_DIR}/backend.pid"

if pidfile_alive "$PIDF"; then
    ok "already running (pid $(cat "$PIDF"))"
elif port_in_use "$LLMHUB_BACKEND_PORT"; then
    die "port ${LLMHUB_BACKEND_PORT} is held by pid $(port_listener "$LLMHUB_BACKEND_PORT") but no pidfile — investigate before starting"
else
    cd "${LLMHUB_SRC_DIR}/backend"
    setsid nohup "${LLMHUB_VENV_DIR}/bin/uvicorn" app.main:app \
        --host "$LLMHUB_BIND_HOST" --port "$LLMHUB_BACKEND_PORT" \
        >> "${LLMHUB_LOG_DIR}/backend.log" 2>&1 < /dev/null &
    echo $! > "$PIDF"
    info "pid $(cat "$PIDF"), waiting for health…"

    # Startup does a full model sync before serving; allow time for it.
    for _ in $(seq 1 40); do
        [ "$(backend_health 3)" = "200" ] && break
        sleep 2
    done
fi

code="$(backend_health 10)"
if [ "$code" = "200" ]; then
    ok "backend healthy — http://${LLMHUB_BIND_HOST}:${LLMHUB_BACKEND_PORT}/api/health"
else
    bad "backend health returned HTTP ${code}"
    info "last log lines:"
    tail -15 "${LLMHUB_LOG_DIR}/backend.log" 2>/dev/null | sed 's/^/    /'
    exit 1
fi

# grep -c prints a count AND exits 1 when the count is zero, so `|| echo 0`
# would emit a second line. `|| true` is enough.
errs="$(grep -cE ' - ERROR - ' "${LLMHUB_LOG_DIR}/backend.log" 2>/dev/null || true)"
errs="${errs:-0}"
if [ "$errs" -gt 0 ]; then
    warn "${errs} ERROR line(s) in the backend log — check model sync"
    grep -E ' - ERROR - ' "${LLMHUB_LOG_DIR}/backend.log" | tail -3 | sed 's/^/    /'
else
    ok "no ERROR lines in the backend log"
fi

printf '\nTunnel from your workstation:\n  ssh -L %s:localhost:%s %s\n' \
    "$LLMHUB_BACKEND_PORT" "$LLMHUB_BACKEND_PORT" "$LLMHUB_VM_HOST"
