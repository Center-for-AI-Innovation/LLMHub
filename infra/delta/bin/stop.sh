#!/bin/bash
# stop.sh — stop the LLMHub services on Delta.
#
# Stops the backend, and PostgreSQL only when asked (--all): the database
# usually wants to outlive a backend restart.
#
# Usage: ./stop.sh [--profile staging|production] [--all]

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

STOP_PG=0
while [ $# -gt 0 ]; do
    case "$1" in
        --profile) export LLMHUB_PROFILE="$2"; shift 2 ;;
        --all)     STOP_PG=1; shift ;;
        -h|--help) sed -n '2,9p' "${BASH_SOURCE[0]}"; exit 0 ;;
        *) die "unknown argument: $1" ;;
    esac
done

printf 'LLMHub stop — profile %s\n' "${LLMHUB_PROFILE:-production}"
require_service_user

# Ask politely, then insist. Never kill by port alone without a pidfile match:
# on a shared VM that port could belong to somebody else's process.
stop_pid() {  # name pidfile
    local name="$1" pidf="$2" p
    if ! pidfile_alive "$pidf"; then
        [ -f "$pidf" ] && rm -f "$pidf"
        info "${name}: not running"
        return 0
    fi
    p="$(cat "$pidf")"
    kill "$p" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 "$p" 2>/dev/null || break; sleep 1; done
    if kill -0 "$p" 2>/dev/null; then
        warn "${name}: pid ${p} ignored SIGTERM, sending SIGKILL"
        kill -9 "$p" 2>/dev/null || true
        sleep 1
    fi
    rm -f "$pidf"
    ok "${name}: stopped (was pid ${p})"
}

step "Backend"
stop_pid backend "${LLMHUB_RUN_DIR}/backend.pid"
if port_in_use "$LLMHUB_BACKEND_PORT"; then
    warn "port ${LLMHUB_BACKEND_PORT} still held by pid $(port_listener "$LLMHUB_BACKEND_PORT") — not killing it, no pidfile match"
fi

if [ "$STOP_PG" = "1" ]; then
step "PostgreSQL"
if [ "$LLMHUB_PG_MODE" != "local" ]; then
    info "external database — nothing to stop"
elif ! pg_running; then
    info "not running"
else
    # Clean shutdown via pg_ctl inside the image, so the cluster is consistent.
    apptainer_env
    apptainer exec --bind "${LLMHUB_PG_ROOT}:/pgroot" "$LLMHUB_PG_IMAGE" \
        pg_ctl -D /pgroot/data -m fast stop >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do pg_running || break; sleep 1; done
    if pg_running; then
        bad "PostgreSQL did not stop cleanly"
    else
        ok "stopped"
    fi
fi
fi
