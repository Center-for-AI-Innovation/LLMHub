#!/bin/bash
# smoke-test.sh — exercise a deployed LLMHub backend for functionality.
#
# Read-only by default: every check is a GET, so it is safe to run against a
# live deployment. Two heavier checks are opt-in:
#
#   --with-sync    POST /api/models/sync   (writes the model catalogue to the DB)
#   --with-launch  reported but NOT run    (would submit a real SLURM job)
#
# Usage:
#   ./smoke-test.sh [--profile staging|production] [--with-sync] [--verbose]
#
# Exit 0 if every check passes, 1 otherwise.

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

WITH_SYNC=0
VERBOSE=0
while [ $# -gt 0 ]; do
    case "$1" in
        --profile)    export LLMHUB_PROFILE="$2"; shift 2 ;;
        --with-sync)  WITH_SYNC=1; shift ;;
        --verbose|-v) VERBOSE=1; shift ;;
        -h|--help)    sed -n '2,14p' "${BASH_SOURCE[0]}"; exit 0 ;;
        *) die "unknown argument: $1" ;;
    esac
done
export REQUIRE_SERVICE_USER=0

BASE="http://${LLMHUB_BIND_HOST}:${LLMHUB_BACKEND_PORT}"
P=0; F=0
pass() { _c 32; printf '  PASS'; _c 0; printf '  %s\n' "$*"; P=$((P+1)); }
fail() { _c 31; printf '  FAIL'; _c 0; printf '  %s\n' "$*"; F=$((F+1)); }
dbg()  { [ "$VERBOSE" = 1 ] && printf '        %s\n' "$*" || true; }

printf 'LLMHub smoke test — %s (profile %s)\n' "$BASE" "${LLMHUB_PROFILE:-production}"

# code <method> <path>  -> HTTP status
code() { curl -s -o /dev/null -w '%{http_code}' -X "$1" --max-time 30 "${BASE}$2" 2>/dev/null || echo 000; }
# body <path> -> response body
body() { curl -s --max-time 30 "${BASE}$1" 2>/dev/null; }

expect() {  # expect <label> <method> <path> <expected-code>
    local got; got="$(code "$2" "$3")"
    if [ "$got" = "$4" ]; then pass "$1 ($2 $3 -> $got)"
    else fail "$1 ($2 $3 -> $got, expected $4)"; fi
}

step "1. Liveness"
expect "root"        GET /              200
expect "health"      GET /api/health/   200
h="$(body /api/health/)"
case "$h" in
    *'"status"'*'"ok"'*) pass "health payload reports ok" ;;
    *) fail "health payload unexpected: ${h:0:80}" ;;
esac

step "2. API surface"
expect "openapi spec" GET /api/openapi.json 200
expect "swagger ui"   GET /docs             200
n_paths="$(body /api/openapi.json | python3 -c 'import sys,json
try: print(len(json.load(sys.stdin).get("paths",{})))
except Exception: print(0)' 2>/dev/null)"
[ "${n_paths:-0}" -ge 10 ] && pass "openapi exposes ${n_paths} paths" \
                           || fail "openapi exposes only ${n_paths:-0} paths"

step "3. Model catalogue (exercises the database read path)"
mc="$(code GET /api/models/)"
if [ "$mc" = "200" ]; then
    # The endpoint answers {"success": true, "models": ["name", ...]} — a list
    # of plain name strings, not objects and not a paginated envelope.
    n_models="$(body /api/models/ | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
    print(len(d.get("models",[])) if isinstance(d,dict) else len(d))
except Exception: print(0)' 2>/dev/null)"
    if [ "${n_models:-0}" -gt 0 ]; then
        pass "GET /api/models/ returned ${n_models} models"
    else
        # 200 with an empty list means the DB has no schema or no sync yet.
        fail "GET /api/models/ returned 200 but 0 models — has db-migrate.sh run?"
    fi
    first="$(body /api/models/ | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
    L=d.get("models",[]) if isinstance(d,dict) else d
    x=L[0] if L else ""
    print(x if isinstance(x,str) else x.get("name",""))
except Exception: print("")' 2>/dev/null)"
    if [ -n "$first" ]; then
        dbg "probing model detail for: ${first}"
        dc="$(code GET "/api/models/$(printf '%s' "$first" | sed 's/ /%20/g')")"
        [ "$dc" = "200" ] && pass "model detail for '${first}'" \
                          || fail "model detail for '${first}' -> ${dc}"
    fi
else
    fail "GET /api/models/ -> ${mc}"
fi

step "4. Deployments and requests (empty is a valid answer)"
expect "list deployments"    GET /api/models/deployments   200
expect "launch defaults"     GET /api/models/launch-defaults 200
expect "list model requests" GET /api/models/requests      200

step "5. Resources"
expect "list resources"    GET /api/resources/        200
expect "resource summary"  GET /api/resources/summary 200

step "6. Catalogue sync (write path)"
if [ "$WITH_SYNC" = "1" ]; then
    sc="$(code POST /api/models/sync)"
    [ "$sc" = "200" ] && pass "POST /api/models/sync -> 200" \
                      || fail "POST /api/models/sync -> ${sc}"
else
    printf '  SKIP  POST /api/models/sync (pass --with-sync to exercise the DB write path)\n'
fi

step "7. Backend log"
if [ -r "${LLMHUB_LOG_DIR}/backend.log" ]; then
    errs="$(grep -cE ' - ERROR - ' "${LLMHUB_LOG_DIR}/backend.log" 2>/dev/null || true)"
    errs="${errs:-0}"
    [ "$errs" -eq 0 ] && pass "0 ERROR lines in backend.log" \
                      || fail "${errs} ERROR line(s) in backend.log"
else
    printf '  SKIP  no backend.log at %s (running against a remote host?)\n' "${LLMHUB_LOG_DIR}"
fi

printf '\n'
printf '  NOTE  inference was NOT exercised. POST /api/models/deployments submits a\n'
printf '        real SLURM job and needs a current /sw/llmhub/vllm.sif; run that\n'
printf '        deliberately, not as part of a smoke test.\n'

printf '\n'; _c 1; printf 'Result: %d passed, %d failed' "$P" "$F"; _c 0; printf '\n'
[ "$F" -gt 0 ] && exit 1
exit 0
