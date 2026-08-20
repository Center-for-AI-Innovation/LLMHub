#!/bin/bash
# preflight.sh — verify everything checkable before deploying.
# Read-only. Safe to run as any account, from a login node or the VM.
#
# Exit 0 if no FAILs (warnings are fine), 1 otherwise.
#
# Usage: ./preflight.sh [--profile staging|production] [--verbose]

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

VERBOSE=0
while [ $# -gt 0 ]; do
    case "$1" in
        --profile)    export LLMHUB_PROFILE="$2"; shift 2 ;;
        --verbose|-v) VERBOSE=1; shift ;;
        -h|--help)    sed -n '2,8p' "${BASH_SOURCE[0]}"; exit 0 ;;
        *) die "unknown argument: $1" ;;
    esac
done
export REQUIRE_SERVICE_USER=0

P=0; W=0; F=0
ok()   { _c 32; printf '  PASS'; _c 0; printf '  %s\n' "$*"; P=$((P+1)); }
warn() { _c 33; printf '  WARN'; _c 0; printf '  %s\n' "$*"; W=$((W+1)); }
bad()  { _c 31; printf '  FAIL'; _c 0; printf '  %s\n' "$*"; F=$((F+1)); }
dbg()  { [ "$VERBOSE" = 1 ] && printf '        %s\n' "$*" || true; }

printf 'LLMHub preflight — profile %s, ref %s, host %s\n' \
    "${LLMHUB_PROFILE:-production}" "$LLMHUB_REF" "$(hostname -s 2>/dev/null)"

step "1. Identity"
who="$(id -un)"
[ "$who" = "$LLMHUB_SERVICE_USER" ] && ok "running as the service user" \
    || warn "running as '${who}', not '${LLMHUB_SERVICE_USER}' — inspection only"
id -nG 2>/dev/null | tr ' ' '\n' | grep -qx "$LLMHUB_GROUP" \
    && ok "member of ${LLMHUB_GROUP}" || bad "not in ${LLMHUB_GROUP}"

step "2. Toolchain"
for t in git apptainer python3 curl; do
    command -v "$t" >/dev/null 2>&1 && ok "${t} present" || bad "${t} MISSING"
done
# uv is bootstrapped by deploy.sh, so its absence is not a failure.
command -v uv >/dev/null 2>&1 && ok "uv present" \
    || warn "uv absent — deploy.sh bootstraps it into ${LLMHUB_UV_DIR}"
if command -v python3 >/dev/null 2>&1; then
    pv="$(python3 -c 'import sys;print("%d.%d"%sys.version_info[:2])' 2>/dev/null)"
    ok "system python3 ${pv} (only used to bootstrap uv; backend runs on ${LLMHUB_PYTHON_VERSION})"
fi

step "3. Source"
if command -v git >/dev/null 2>&1; then
    sha="$(git ls-remote "$LLMHUB_REPO" "refs/tags/${LLMHUB_REF}^{}" 2>/dev/null | awk '{print $1}' | head -1)"
    [ -z "$sha" ] && sha="$(git ls-remote "$LLMHUB_REPO" "refs/tags/${LLMHUB_REF}" 2>/dev/null | awk '{print $1}' | head -1)"
    [ -n "$sha" ] && ok "tag ${LLMHUB_REF} resolves to ${sha:0:9}" \
        || bad "tag ${LLMHUB_REF} does not resolve at ${LLMHUB_REPO}"
fi
if [ -d "${LLMHUB_SRC_DIR}/.git" ]; then
    [ -z "$(git -c safe.directory='*' -C "$LLMHUB_SRC_DIR" status --porcelain 2>/dev/null | head -1)" ] \
        && ok "existing tree is clean" || bad "existing tree is dirty"
else
    warn "no tree at ${LLMHUB_SRC_DIR} yet (expected before first deploy)"
fi

step "4. Filesystem"
parent="$LLMHUB_DEPLOY_ROOT"
while [ ! -d "$parent" ] && [ "$parent" != "/" ]; do parent="$(dirname "$parent")"; done
if [ -w "$parent" ]; then
    ok "can write under ${parent}"
else
    bad "cannot write under ${parent} — check the ACL: getfacl ${parent}"
    dbg "ls shows the ACL mask in the group field; 'group::' in getfacl is what applies"
fi
avail="$(df -Pk "$parent" 2>/dev/null | tail -1 | awk '{print $4}')"
[ -n "$avail" ] && { g=$((avail/1024/1024));
    [ "$g" -ge 20 ] && ok "${g} G free on $(df -Pk "$parent"|tail -1|awk '{print $6}')" \
                    || warn "only ${g} G free under ${parent}"; }
# PostgreSQL and Apptainer cannot live on Lustre (nodev), hence /var/tmp.
[ -w "$LLMHUB_VAR_TMP" ] && ok "${LLMHUB_VAR_TMP} writable (postgres + apptainer cache)" \
    || bad "${LLMHUB_VAR_TMP} not writable — required, /projects is nodev"

step "5. Containers"
if [ -r "$LLMHUB_VLLM_SIF" ]; then
    age=$(( ( $(date +%s) - $(date -r "$LLMHUB_VLLM_SIF" +%s) ) / 86400 ))
    ok "vLLM image present ($(date -r "$LLMHUB_VLLM_SIF" +%Y-%m-%d), ${age}d old)"
    [ "$age" -gt 180 ] && warn "image is stale; devops/apptainers builds ${LLMHUB_VLLM_IMAGE_EXPECTED}"
else
    bad "vLLM image missing: ${LLMHUB_VLLM_SIF}"
fi

step "6. Ports"
for spec in "postgres:${LLMHUB_PG_PORT}" "backend:${LLMHUB_BACKEND_PORT}"; do
    n="${spec%%:*}"; p="${spec##*:}"
    port_in_use "$p" && warn "${n} port ${p} already in use (pid $(port_listener "$p"))" \
                     || ok "${n} port ${p} free"
done

step "7. Secrets"
if [ -r "$LLMHUB_SECRETS_FILE" ]; then
    m="$(stat -c '%a' "$LLMHUB_SECRETS_FILE" 2>/dev/null)"
    [ "$m" = "600" ] && ok "secrets file mode 0600" || bad "secrets file mode ${m}, must be 0600"
else
    # The v0.1.1 backend needs only SMTP_*, all optional.
    warn "no secrets file at ${LLMHUB_SECRETS_FILE} (backend-only deploys need almost nothing)"
fi

printf '\n'; _c 1; printf 'Result: %d pass, %d warn, %d fail' "$P" "$W" "$F"; _c 0; printf '\n'
[ "$F" -gt 0 ] && { printf 'Preflight FAILED.\n'; exit 1; }
printf 'Preflight passed.\n'
