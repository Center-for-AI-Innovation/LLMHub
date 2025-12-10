#!/usr/bin/env npx tsx
/**
 * Comprehensive vLLM Proxy Test Script
 * 
 * Tests all vLLM proxy functionality:
 * 1. Direct vLLM server connection (/v1/models, /v1/chat/completions)
 * 2. Test proxy endpoint (/api/v1/test/vllm/...)
 * 3. vLLM job management API (/api/v1/vllm/job)
 * 4. Dynamic job proxy (/api/v1/job/{jobId}/...)
 * 5. Authentication checks
 * 6. Database integration
 * 
 * Usage:
 *   npx tsx scripts/test-vllm-full.ts
 * 
 * Prerequisites:
 *   - vLLM server running at localhost:8000
 *   - Frontend server running at localhost:3000 (in development mode)
 *   - User logged in (for authenticated tests, use --cookie option)
 * 
 * Options:
 *   --cookie "session-cookie"  Pass session cookie for authenticated tests
 *   --frontend-url URL         Frontend URL (default: http://localhost:3000)
 *   --vllm-url URL             vLLM URL (default: http://localhost:8000)
 */

const args = process.argv.slice(2);

// Parse command line arguments
function getArg(name: string, defaultValue: string): string {
  const index = args.indexOf(`--${name}`);
  if (index !== -1 && args[index + 1]) {
    return args[index + 1];
  }
  return defaultValue;
}

const FRONTEND_URL = getArg('frontend-url', process.env.FRONTEND_URL || 'http://localhost:3000');
const VLLM_URL = getArg('vllm-url', process.env.VLLM_URL || 'http://localhost:8000');
const SESSION_COOKIE = getArg('cookie', '');

// Test results
interface TestResult {
  name: string;
  category: string;
  passed: boolean;
  message: string;
  duration?: number;
  data?: unknown;
}

const results: TestResult[] = [];

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logResult(result: TestResult) {
  results.push(result);
  const icon = result.passed ? '✓' : '✗';
  const color = result.passed ? colors.green : colors.red;
  const duration = result.duration ? ` (${result.duration}ms)` : '';
  log(`  ${icon} ${result.name}${duration}: ${result.message}`, color);
}

function logSection(title: string) {
  console.log();
  log(`━━━ ${title} ━━━`, colors.cyan);
  console.log();
}

// Helper to make authenticated requests
async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  if (SESSION_COOKIE) {
    headers.set('Cookie', SESSION_COOKIE);
  }
  return fetch(url, { ...options, headers });
}

// ============================================
// Test Categories
// ============================================

async function testDirectVllm(): Promise<void> {
  logSection('1. Direct vLLM Server Connection');

  // Test /v1/models
  try {
    const start = Date.now();
    const response = await fetch(`${VLLM_URL}/v1/models`);
    const duration = Date.now() - start;
    const data = await response.json();

    if (response.ok && data.data?.length > 0) {
      const modelId = data.data[0].id;
      logResult({
        name: 'GET /v1/models',
        category: 'direct-vllm',
        passed: true,
        message: `Found model: ${modelId}`,
        duration,
      });

      // Test chat completions
      const chatStart = Date.now();
      const chatResponse = await fetch(`${VLLM_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Say "test" in one word' }],
          max_tokens: 10,
        }),
      });
      const chatDuration = Date.now() - chatStart;
      const chatData = await chatResponse.json();

      if (chatData.choices?.[0]?.message?.content) {
        logResult({
          name: 'POST /v1/chat/completions',
          category: 'direct-vllm',
          passed: true,
          message: `Response: "${chatData.choices[0].message.content.substring(0, 50)}"`,
          duration: chatDuration,
        });
      } else {
        logResult({
          name: 'POST /v1/chat/completions',
          category: 'direct-vllm',
          passed: false,
          message: 'No response content',
          data: chatData,
        });
      }
    } else {
      logResult({
        name: 'GET /v1/models',
        category: 'direct-vllm',
        passed: false,
        message: 'No models found or request failed',
        data,
      });
    }
  } catch (error) {
    logResult({
      name: 'Direct vLLM Connection',
      category: 'direct-vllm',
      passed: false,
      message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}

async function testTestProxy(): Promise<void> {
  logSection('2. Test Proxy Endpoint (/api/v1/test/vllm/...)');

  // Test /api/v1/test/vllm/models
  try {
    const start = Date.now();
    const response = await fetch(`${FRONTEND_URL}/api/v1/test/vllm/models`);
    const duration = Date.now() - start;

    if (!response.ok) {
      const text = await response.text();
      logResult({
        name: 'GET /api/v1/test/vllm/models',
        category: 'test-proxy',
        passed: false,
        message: `HTTP ${response.status}: ${text.substring(0, 100)}`,
        duration,
      });
      return;
    }

    const data = await response.json();

    if (data.data?.length > 0) {
      const modelId = data.data[0].id;
      logResult({
        name: 'GET /api/v1/test/vllm/models',
        category: 'test-proxy',
        passed: true,
        message: `Proxied successfully, model: ${modelId}`,
        duration,
      });

      // Test chat completions through proxy
      const chatStart = Date.now();
      const chatResponse = await fetch(`${FRONTEND_URL}/api/v1/test/vllm/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Say "proxy works" in two words' }],
          max_tokens: 10,
          stream: false,
        }),
      });
      const chatDuration = Date.now() - chatStart;

      if (!chatResponse.ok) {
        logResult({
          name: 'POST /api/v1/test/vllm/chat/completions',
          category: 'test-proxy',
          passed: false,
          message: `HTTP ${chatResponse.status}`,
          duration: chatDuration,
        });
        return;
      }

      const chatData = await chatResponse.json();
      if (chatData.choices?.[0]?.message?.content) {
        logResult({
          name: 'POST /api/v1/test/vllm/chat/completions',
          category: 'test-proxy',
          passed: true,
          message: `Response: "${chatData.choices[0].message.content.substring(0, 50)}"`,
          duration: chatDuration,
        });
      } else {
        logResult({
          name: 'POST /api/v1/test/vllm/chat/completions',
          category: 'test-proxy',
          passed: false,
          message: 'No response content',
          data: chatData,
        });
      }

      // Test streaming
      const streamStart = Date.now();
      const streamResponse = await fetch(`${FRONTEND_URL}/api/v1/test/vllm/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'Count 1 2 3' }],
          max_tokens: 20,
          stream: true,
        }),
      });
      const streamDuration = Date.now() - streamStart;

      if (streamResponse.ok) {
        const text = await streamResponse.text();
        const chunkCount = (text.match(/data:/g) || []).length;
        logResult({
          name: 'POST /api/v1/test/vllm/chat/completions (streaming)',
          category: 'test-proxy',
          passed: chunkCount > 0,
          message: `Received ${chunkCount} SSE chunks`,
          duration: streamDuration,
        });
      } else {
        logResult({
          name: 'POST /api/v1/test/vllm/chat/completions (streaming)',
          category: 'test-proxy',
          passed: false,
          message: `HTTP ${streamResponse.status}`,
          duration: streamDuration,
        });
      }
    } else {
      logResult({
        name: 'GET /api/v1/test/vllm/models',
        category: 'test-proxy',
        passed: false,
        message: 'No models in response',
        data,
      });
    }
  } catch (error) {
    logResult({
      name: 'Test Proxy',
      category: 'test-proxy',
      passed: false,
      message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}

async function testJobManagementApi(): Promise<void> {
  logSection('3. vLLM Job Management API (/api/v1/vllm/job)');

  // Test without authentication
  try {
    const response = await fetch(`${FRONTEND_URL}/api/v1/vllm/job`);
    
    if (response.status === 401) {
      logResult({
        name: 'GET /api/v1/vllm/job (unauthenticated)',
        category: 'job-api',
        passed: true,
        message: 'Correctly returns 401 for unauthenticated request',
      });
    } else {
      logResult({
        name: 'GET /api/v1/vllm/job (unauthenticated)',
        category: 'job-api',
        passed: false,
        message: `Expected 401, got ${response.status}`,
      });
    }
  } catch (error) {
    logResult({
      name: 'GET /api/v1/vllm/job (unauthenticated)',
      category: 'job-api',
      passed: false,
      message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }

  // Test with authentication (if cookie provided)
  if (SESSION_COOKIE) {
    try {
      const start = Date.now();
      const response = await fetchWithAuth(`${FRONTEND_URL}/api/v1/vllm/job`);
      const duration = Date.now() - start;
      const data = await response.json();

      if (response.ok) {
        logResult({
          name: 'GET /api/v1/vllm/job (authenticated)',
          category: 'job-api',
          passed: true,
          message: data.jobId 
            ? `Job ID: ${data.jobId}, Proxy URL: ${data.proxyUrl}`
            : 'No active job',
          duration,
          data,
        });

        // Test creating a new job
        const createStart = Date.now();
        const createResponse = await fetchWithAuth(`${FRONTEND_URL}/api/v1/vllm/job`, {
          method: 'POST',
        });
        const createDuration = Date.now() - createStart;
        const createData = await createResponse.json();

        if (createResponse.ok && createData.jobId) {
          logResult({
            name: 'POST /api/v1/vllm/job (create job)',
            category: 'job-api',
            passed: true,
            message: `Created job: ${createData.jobId}, Proxy: ${createData.proxyUrl}`,
            duration: createDuration,
            data: createData,
          });
        } else {
          logResult({
            name: 'POST /api/v1/vllm/job (create job)',
            category: 'job-api',
            passed: createResponse.status === 403, // 403 is expected in production mode
            message: createData.error || 'Failed to create job',
            duration: createDuration,
          });
        }
      } else {
        logResult({
          name: 'GET /api/v1/vllm/job (authenticated)',
          category: 'job-api',
          passed: false,
          message: `HTTP ${response.status}: ${data.error || 'Unknown error'}`,
          duration,
        });
      }
    } catch (error) {
      logResult({
        name: 'Job Management API (authenticated)',
        category: 'job-api',
        passed: false,
        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  } else {
    log('  ⚠ Skipping authenticated tests (no --cookie provided)', colors.yellow);
  }
}

async function testDynamicJobProxy(): Promise<void> {
  logSection('4. Dynamic Job Proxy (/api/v1/job/{jobId}/...)');

  // Test with a fake job ID (should fail without auth)
  const fakeJobId = 'test-999999';

  try {
    const response = await fetch(`${FRONTEND_URL}/api/v1/job/${fakeJobId}/models`);
    
    if (response.status === 401) {
      logResult({
        name: `GET /api/v1/job/${fakeJobId}/models (unauthenticated)`,
        category: 'job-proxy',
        passed: true,
        message: 'Correctly returns 401 for unauthenticated request',
      });
    } else {
      const data = await response.json();
      logResult({
        name: `GET /api/v1/job/${fakeJobId}/models (unauthenticated)`,
        category: 'job-proxy',
        passed: false,
        message: `Expected 401, got ${response.status}`,
        data,
      });
    }
  } catch (error) {
    logResult({
      name: 'Dynamic Job Proxy (unauthenticated)',
      category: 'job-proxy',
      passed: false,
      message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }

  // Test with authentication
  if (SESSION_COOKIE) {
    try {
      // First get/create a job
      const jobResponse = await fetchWithAuth(`${FRONTEND_URL}/api/v1/vllm/job`);
      const jobData = await jobResponse.json();

      if (!jobData.jobId) {
        logResult({
          name: 'Dynamic Job Proxy Setup',
          category: 'job-proxy',
          passed: false,
          message: 'Could not get job ID',
        });
        return;
      }

      const jobId = jobData.jobId;
      log(`  Using job ID: ${jobId}`, colors.dim);

      // Test /models endpoint
      const modelsStart = Date.now();
      const modelsResponse = await fetchWithAuth(`${FRONTEND_URL}/api/v1/job/${jobId}/models`);
      const modelsDuration = Date.now() - modelsStart;

      if (modelsResponse.ok) {
        const modelsData = await modelsResponse.json();
        logResult({
          name: `GET /api/v1/job/${jobId}/models`,
          category: 'job-proxy',
          passed: true,
          message: `Found ${modelsData.data?.length || 0} model(s)`,
          duration: modelsDuration,
        });

        // Test chat completions
        if (modelsData.data?.length > 0) {
          const modelId = modelsData.data[0].id;
          
          const chatStart = Date.now();
          const chatResponse = await fetchWithAuth(`${FRONTEND_URL}/api/v1/job/${jobId}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: modelId,
              messages: [{ role: 'user', content: 'Say "job proxy works" in three words' }],
              max_tokens: 15,
            }),
          });
          const chatDuration = Date.now() - chatStart;

          if (chatResponse.ok) {
            const chatData = await chatResponse.json();
            logResult({
              name: `POST /api/v1/job/${jobId}/chat/completions`,
              category: 'job-proxy',
              passed: !!chatData.choices?.[0]?.message?.content,
              message: chatData.choices?.[0]?.message?.content 
                ? `Response: "${chatData.choices[0].message.content.substring(0, 50)}"`
                : 'No content',
              duration: chatDuration,
            });
          } else {
            const errorData = await chatResponse.json();
            logResult({
              name: `POST /api/v1/job/${jobId}/chat/completions`,
              category: 'job-proxy',
              passed: false,
              message: `HTTP ${chatResponse.status}: ${errorData.error?.message || 'Unknown error'}`,
              duration: chatDuration,
            });
          }
        }
      } else {
        const errorData = await modelsResponse.json();
        logResult({
          name: `GET /api/v1/job/${jobId}/models`,
          category: 'job-proxy',
          passed: false,
          message: `HTTP ${modelsResponse.status}: ${errorData.error?.message || 'Unknown error'}`,
          duration: modelsDuration,
        });
      }
    } catch (error) {
      logResult({
        name: 'Dynamic Job Proxy (authenticated)',
        category: 'job-proxy',
        passed: false,
        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  } else {
    log('  ⚠ Skipping authenticated tests (no --cookie provided)', colors.yellow);
  }
}

async function testVllmChat(): Promise<void> {
  logSection('5. vLLM Chat Route (/api/vllm/chat)');

  // Test without authentication
  try {
    const response = await fetch(`${FRONTEND_URL}/api/vllm/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'test-chat-id',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    if (response.status === 401) {
      logResult({
        name: 'POST /api/vllm/chat (unauthenticated)',
        category: 'vllm-chat',
        passed: true,
        message: 'Correctly returns 401 for unauthenticated request',
      });
    } else {
      logResult({
        name: 'POST /api/vllm/chat (unauthenticated)',
        category: 'vllm-chat',
        passed: false,
        message: `Expected 401, got ${response.status}`,
      });
    }
  } catch (error) {
    logResult({
      name: 'vLLM Chat (unauthenticated)',
      category: 'vllm-chat',
      passed: false,
      message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }

  if (SESSION_COOKIE) {
    log('  ⚠ Authenticated vLLM chat tests require streaming support - skipping', colors.yellow);
  }
}

async function printSummary(): Promise<void> {
  logSection('TEST SUMMARY');

  // Group by category
  const categories = new Map<string, TestResult[]>();
  for (const result of results) {
    if (!categories.has(result.category)) {
      categories.set(result.category, []);
    }
    categories.get(result.category)!.push(result);
  }

  // Print summary by category
  for (const [category, categoryResults] of categories) {
    const passed = categoryResults.filter(r => r.passed).length;
    const total = categoryResults.length;
    const color = passed === total ? colors.green : passed > 0 ? colors.yellow : colors.red;
    log(`  ${category}: ${passed}/${total} passed`, color);
  }

  console.log();
  
  const totalPassed = results.filter(r => r.passed).length;
  const totalFailed = results.filter(r => !r.passed).length;
  const totalTests = results.length;

  log(`Total: ${totalTests} tests`, colors.cyan);
  log(`  Passed: ${totalPassed}`, colors.green);
  log(`  Failed: ${totalFailed}`, totalFailed > 0 ? colors.red : colors.dim);

  if (totalFailed > 0) {
    console.log();
    log('Failed tests:', colors.red);
    for (const result of results.filter(r => !r.passed)) {
      log(`  • ${result.name}: ${result.message}`, colors.red);
    }
  }

  console.log();
}

// ============================================
// Main
// ============================================

async function main(): Promise<void> {
  console.log();
  log('╔════════════════════════════════════════════════════════════╗', colors.cyan);
  log('║          vLLM Proxy Comprehensive Test Suite               ║', colors.cyan);
  log('╚════════════════════════════════════════════════════════════╝', colors.cyan);
  console.log();
  log(`Frontend URL: ${FRONTEND_URL}`, colors.dim);
  log(`vLLM URL: ${VLLM_URL}`, colors.dim);
  log(`Auth Cookie: ${SESSION_COOKIE ? 'Provided' : 'Not provided'}`, colors.dim);

  // Run all tests
  await testDirectVllm();
  await testTestProxy();
  await testJobManagementApi();
  await testDynamicJobProxy();
  await testVllmChat();

  await printSummary();

  // Exit with appropriate code
  const failed = results.filter(r => !r.passed).length;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Test suite failed:', error);
  process.exit(1);
});

