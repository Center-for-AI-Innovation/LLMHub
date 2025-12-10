#!/bin/bash
#
# vLLM Proxy Quick Test Script
#
# A simple shell script to test vLLM proxy endpoints
#
# Usage:
#   ./scripts/test-vllm-quick.sh
#   ./scripts/test-vllm-quick.sh --cookie "session-cookie-value"
#
# Prerequisites:
#   - vLLM server running at localhost:8000
#   - Frontend server running at localhost:3000 (in development mode)

set -e

# Parse arguments
COOKIE=""
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --cookie) COOKIE="$2"; shift ;;
        *) echo "Unknown parameter: $1"; exit 1 ;;
    esac
    shift
done

FRONTEND_URL="${FRONTEND_URL:-http://localhost:3000}"
VLLM_URL="${VLLM_URL:-http://localhost:8000}"

echo ""
echo "========================================"
echo "   vLLM Proxy Quick Test"
echo "========================================"
echo ""
echo "Frontend: $FRONTEND_URL"
echo "vLLM:     $VLLM_URL"
echo "Cookie:   ${COOKIE:+provided}"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

passed=0
failed=0

test_result() {
    if [ "$1" = "pass" ]; then
        echo -e "${GREEN}✓ $2${NC}"
        ((passed++))
    else
        echo -e "${RED}✗ $2${NC}"
        ((failed++))
    fi
}

section() {
    echo ""
    echo -e "${CYAN}━━━ $1 ━━━${NC}"
    echo ""
}

# ========================================
section "1. Direct vLLM Connection"
# ========================================

MODELS=$(curl -s "$VLLM_URL/v1/models")
if echo "$MODELS" | grep -q '"id"'; then
    MODEL_ID=$(echo "$MODELS" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
    test_result "pass" "GET /v1/models - Found: $MODEL_ID"
else
    test_result "fail" "GET /v1/models - No models found"
    echo "Response: $MODELS"
    MODEL_ID=""
fi

if [ -n "$MODEL_ID" ]; then
    CHAT=$(curl -s -X POST "$VLLM_URL/v1/chat/completions" \
        -H "Content-Type: application/json" \
        -d "{\"model\": \"$MODEL_ID\", \"messages\": [{\"role\": \"user\", \"content\": \"Say test\"}], \"max_tokens\": 5}")
    
    if echo "$CHAT" | grep -q '"content"'; then
        test_result "pass" "POST /v1/chat/completions - Response received"
    else
        test_result "fail" "POST /v1/chat/completions - No response"
    fi
fi

# ========================================
section "2. Test Proxy (/api/v1/test/vllm)"
# ========================================

PROXY_MODELS=$(curl -s "$FRONTEND_URL/api/v1/test/vllm/models")
if echo "$PROXY_MODELS" | grep -q '"id"'; then
    test_result "pass" "GET /api/v1/test/vllm/models - Proxy working"
else
    test_result "fail" "GET /api/v1/test/vllm/models - Proxy failed"
    echo "Response: $(echo "$PROXY_MODELS" | head -c 200)"
fi

if [ -n "$MODEL_ID" ]; then
    PROXY_CHAT=$(curl -s -X POST "$FRONTEND_URL/api/v1/test/vllm/chat/completions" \
        -H "Content-Type: application/json" \
        -d "{\"model\": \"$MODEL_ID\", \"messages\": [{\"role\": \"user\", \"content\": \"Say proxy\"}], \"max_tokens\": 5}")
    
    if echo "$PROXY_CHAT" | grep -q '"content"'; then
        test_result "pass" "POST /api/v1/test/vllm/chat/completions - Proxy working"
    else
        test_result "fail" "POST /api/v1/test/vllm/chat/completions - Proxy failed"
    fi
fi

# ========================================
section "3. Job Management API (/api/v1/vllm/job)"
# ========================================

# Test without auth
JOB_UNAUTH=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL/api/v1/vllm/job")
if [ "$JOB_UNAUTH" = "401" ]; then
    test_result "pass" "GET /api/v1/vllm/job (no auth) - Returns 401"
else
    test_result "fail" "GET /api/v1/vllm/job (no auth) - Expected 401, got $JOB_UNAUTH"
fi

# Test with auth
if [ -n "$COOKIE" ]; then
    JOB_AUTH=$(curl -s -H "Cookie: $COOKIE" "$FRONTEND_URL/api/v1/vllm/job")
    if echo "$JOB_AUTH" | grep -q '"jobId"'; then
        JOB_ID=$(echo "$JOB_AUTH" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)
        PROXY_URL=$(echo "$JOB_AUTH" | grep -o '"proxyUrl":"[^"]*"' | cut -d'"' -f4)
        test_result "pass" "GET /api/v1/vllm/job (auth) - Job: $JOB_ID"
        echo "       Proxy URL: $PROXY_URL"
    else
        test_result "fail" "GET /api/v1/vllm/job (auth) - No job returned"
        echo "Response: $JOB_AUTH"
    fi
else
    echo -e "${YELLOW}⚠ Skipping authenticated tests (no --cookie provided)${NC}"
fi

# ========================================
section "4. Dynamic Job Proxy (/api/v1/job/{id})"
# ========================================

# Test without auth
FAKE_JOB="test-999999"
JOB_PROXY_UNAUTH=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL/api/v1/job/$FAKE_JOB/models")
if [ "$JOB_PROXY_UNAUTH" = "401" ]; then
    test_result "pass" "GET /api/v1/job/$FAKE_JOB/models (no auth) - Returns 401"
else
    test_result "fail" "GET /api/v1/job/$FAKE_JOB/models (no auth) - Expected 401, got $JOB_PROXY_UNAUTH"
fi

# Test with auth
if [ -n "$COOKIE" ] && [ -n "$JOB_ID" ]; then
    JOB_PROXY_MODELS=$(curl -s -H "Cookie: $COOKIE" "$FRONTEND_URL/api/v1/job/$JOB_ID/models")
    if echo "$JOB_PROXY_MODELS" | grep -q '"id"'; then
        test_result "pass" "GET /api/v1/job/$JOB_ID/models - Proxy working"
        
        # Test chat completions through job proxy
        if [ -n "$MODEL_ID" ]; then
            JOB_PROXY_CHAT=$(curl -s -X POST "$FRONTEND_URL/api/v1/job/$JOB_ID/chat/completions" \
                -H "Cookie: $COOKIE" \
                -H "Content-Type: application/json" \
                -d "{\"model\": \"$MODEL_ID\", \"messages\": [{\"role\": \"user\", \"content\": \"Say job\"}], \"max_tokens\": 5}")
            
            if echo "$JOB_PROXY_CHAT" | grep -q '"content"'; then
                test_result "pass" "POST /api/v1/job/$JOB_ID/chat/completions - Working"
            else
                test_result "fail" "POST /api/v1/job/$JOB_ID/chat/completions - Failed"
                echo "Response: $(echo "$JOB_PROXY_CHAT" | head -c 200)"
            fi
        fi
    else
        test_result "fail" "GET /api/v1/job/$JOB_ID/models - Proxy failed"
        echo "Response: $(echo "$JOB_PROXY_MODELS" | head -c 200)"
    fi
elif [ -z "$COOKIE" ]; then
    echo -e "${YELLOW}⚠ Skipping authenticated tests (no --cookie provided)${NC}"
fi

# ========================================
section "5. vLLM Chat Route (/api/vllm/chat)"
# ========================================

CHAT_UNAUTH=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$FRONTEND_URL/api/vllm/chat" \
    -H "Content-Type: application/json" \
    -d '{"id": "test", "messages": [{"role": "user", "content": "hi"}]}')
    
if [ "$CHAT_UNAUTH" = "401" ]; then
    test_result "pass" "POST /api/vllm/chat (no auth) - Returns 401"
else
    test_result "fail" "POST /api/vllm/chat (no auth) - Expected 401, got $CHAT_UNAUTH"
fi

# ========================================
section "SUMMARY"
# ========================================

echo ""
echo "Total: $((passed + failed)) tests"
echo -e "${GREEN}Passed: $passed${NC}"
echo -e "${RED}Failed: $failed${NC}"
echo ""

if [ $failed -gt 0 ]; then
    exit 1
else
    exit 0
fi

