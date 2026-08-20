#!/bin/bash
# db-migrate.sh — create the LLMHub database schema on Delta.
#
# The backend reads tables that the FRONTEND owns: the schema is defined by
# Drizzle migrations under frontend/lib/db/migrations/. Without them the
# backend starts but every model sync fails with
#   (psycopg2.errors.UndefinedTable) relation "AvailableModel" does not exist
#
# `pnpm db:migrate` is the upstream path, but it needs node/pnpm, which the
# Delta VM does not have. Drizzle emits plain .sql files, so this applies them
# with psql inside the postgres container instead — no node required.
#
# DRY RUN BY DEFAULT. Pass --apply to act.
#
# Usage: ./db-migrate.sh [--apply] [--profile staging|production]

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
while [ $# -gt 0 ]; do
    case "$1" in
        --apply)   APPLY=1; shift ;;
        --profile) export LLMHUB_PROFILE="$2"; shift 2 ;;
        -h|--help) sed -n '2,16p' "${BASH_SOURCE[0]}"; exit 0 ;;
        *) die "unknown argument: $1" ;;
    esac
done

MIG_DIR="${LLMHUB_SRC_DIR}/frontend/lib/db/migrations"

printf 'LLMHub db-migrate [%s]\n' "$([ "$APPLY" = 1 ] && echo APPLY || echo 'DRY RUN')"
printf 'database: %s (mode %s)\n' "$LLMHUB_PG_DB" "$LLMHUB_PG_MODE"

step "Checks"
require_service_user
[ -d "$MIG_DIR" ] || die "no migrations at ${MIG_DIR} — run deploy.sh first"

MIGRATIONS=$(find "$MIG_DIR" -maxdepth 1 -name '[0-9]*.sql' | sort)
[ -n "$MIGRATIONS" ] || die "no .sql migrations found in ${MIG_DIR}"
info "$(printf '%s\n' "$MIGRATIONS" | wc -l) migration file(s)"

if [ "$LLMHUB_PG_MODE" = "local" ]; then
    pg_running || die "PostgreSQL is not listening on ${LLMHUB_PG_PORT}. Run ./bin/start.sh first."
    ok "postgres socket present"
else
    warn "external database mode — applying migrations to ${LLMHUB_PG_MODE} target"
fi

step "Ensure database exists"
if [ "$APPLY" = "1" ] && [ "$LLMHUB_PG_MODE" = "local" ]; then
    if pg_psql -tAc "SELECT 1 FROM pg_database WHERE datname='${LLMHUB_PG_DB}'" 2>/dev/null | grep -q 1; then
        info "database ${LLMHUB_PG_DB} already exists"
    else
        pg_psql -q -c "CREATE DATABASE ${LLMHUB_PG_DB}" >/dev/null
        ok "created database ${LLMHUB_PG_DB}"
    fi
else
    info "would ensure database ${LLMHUB_PG_DB} exists"
fi

step "Apply migrations"
for f in $MIGRATIONS; do
    b="$(basename "$f")"
    if [ "$APPLY" = "1" ]; then
        # ON_ERROR_STOP so a failed migration aborts rather than half-applying.
        # Drizzle's '--> statement-breakpoint' markers are SQL comments to psql.
        if apptainer exec --bind "${LLMHUB_PG_ROOT}:/pgroot" --bind "${MIG_DIR}:/mig" \
             "$LLMHUB_PG_IMAGE" psql -q -v ON_ERROR_STOP=1 \
             -h /pgroot -p "$LLMHUB_PG_PORT" -U "$LLMHUB_PG_USER" \
             -d "$LLMHUB_PG_DB" -f "/mig/${b}" >/dev/null 2>&1; then
            ok "applied ${b}"
        else
            # Re-running an already-applied migration fails on duplicate
            # objects; that is expected and not fatal.
            warn "${b} did not apply cleanly (already applied?) — verifying below"
        fi
    else
        info "would apply ${b}"
    fi
done

step "Verify"
if [ "$APPLY" = "1" ]; then
    n="$(pg_psql -tAd "$LLMHUB_PG_DB" -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null | tr -d ' \r')"
    info "tables in public schema: ${n:-?}"
    if pg_psql -tAd "$LLMHUB_PG_DB" -c "SELECT to_regclass('public.\"AvailableModel\"')" 2>/dev/null | grep -q AvailableModel; then
        ok 'AvailableModel exists — the backend model sync will succeed'
    else
        die 'AvailableModel is missing — the backend model sync will fail'
    fi
else
    info "would verify AvailableModel exists"
fi
