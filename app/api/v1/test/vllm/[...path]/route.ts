/**
 * vLLM Test Proxy Route
 * 
 * This endpoint is for DEVELOPMENT/TESTING ONLY.
 * It bypasses the deployment lookup and directly proxies to the configured vLLM server.
 * 
 * Usage: /api/v1/test/vllm/models, /api/v1/test/vllm/chat/completions, etc.
 * 
 * WARNING: This endpoint should be disabled in production!
 */

import { auth } from '@/app/(auth)/auth';
import {
  proxyStreamingRequest,
  proxyRequest,
  isStreamingEndpoint,
  createErrorResponse,
} from '@/lib/vllm-proxy';

export const maxDuration = 60;

// Test vLLM base URL - uses environment variable or defaults to localhost:8000
const TEST_VLLM_BASE_URL = process.env.VLLM_BASE_URL?.replace(/\/v1\/?$/, '') || 'http://localhost:8000';

/**
 * Build the target vLLM URL for testing
 */
function buildTestVllmUrl(path: string[]): string {
  return `${TEST_VLLM_BASE_URL}/v1/${path.join('/')}`;
}

/**
 * Common handler for all HTTP methods
 */
async function handleRequest(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  // Check if we're in development mode
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  if (!isDevelopment) {
    return createErrorResponse('Test endpoint is only available in development mode', 403);
  }

  try {
    const { path } = await params;

    // Step 1: Verify user is authenticated (optional for testing, but good practice)
    const session = await auth();

    if (!session || !session.user || !session.user.id) {
      // For testing, we'll allow unauthenticated requests but log a warning
      console.warn('[TEST PROXY] Unauthenticated request to test vLLM endpoint');
    }

    // Step 2: Build the target vLLM URL
    const targetUrl = buildTestVllmUrl(path);
    console.log(`[TEST PROXY] Proxying to: ${targetUrl}`);

    // Step 3: Proxy the request
    if (isStreamingEndpoint(path)) {
      return await proxyStreamingRequest(targetUrl, request);
    }
    
    return await proxyRequest(targetUrl, request);
  } catch (error) {
    console.error('[TEST PROXY] Error:', error);
    return createErrorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
}

// Export handlers for all HTTP methods
export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

