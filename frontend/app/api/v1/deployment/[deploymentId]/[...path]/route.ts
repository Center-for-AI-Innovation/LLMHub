/**
 * vLLM Proxy Route Handler
 * 
 * This catch-all route handler proxies authenticated requests to vLLM instances
 * running on Slurm worker nodes. It supports all OpenAI-compatible endpoints:
 * 
 * - /api/v1/deployment/{deploymentId}/chat/completions -> {endpointUrl}/v1/chat/completions
 * - /api/v1/deployment/{deploymentId}/completions -> {endpointUrl}/v1/completions
 * - /api/v1/deployment/{deploymentId}/embeddings -> {endpointUrl}/v1/embeddings
 * - /api/v1/deployment/{deploymentId}/models -> {endpointUrl}/v1/models
 * 
 * Security:
 * 1. Verifies user is authenticated via NextAuth session
 * 2. Verifies user owns the deployment
 * 3. Verifies deployment is in "ready" status
 * 4. Proxies the request to the actual vLLM endpoint
 * 
 * For chat/completions with the x-ai-sdk header, uses Vercel AI SDK's 
 * createDataStreamResponse to ensure compatibility with the useChat hook.
 * Direct API calls without this header receive standard OpenAI-compatible responses.
 */

import { auth } from '@/app/(auth)/auth';
import { getUserById, getModelDeploymentById } from '@/lib/db/queries';
import {
  isChatCompletionsEndpoint,
  handleChatCompletions,
} from '@/lib/vllm-ai-sdk';
import { createErrorResponse, validateDeployment } from '@/lib/utils';
import { canUserAccessDeployment } from '@/lib/auth/validate-request';
import type { ModelDeployment } from '@/hooks/use-models';

export const maxDuration = 60;

/**
 * Common handler for all HTTP methods
 */
async function handleRequest(
  request: Request,
  { params }: { params: Promise<{ deploymentId: string; path: string[] }> }
): Promise<Response> {
  try {
    const parsedParams = await params;
    const { deploymentId, path } = parsedParams;

    // Step 1: Verify user is authenticated
    const session = await auth();

    if (!session || !session.user || !session.user.id) {
      return createErrorResponse('Unauthorized - Please log in to continue', 401);
    }

    const userId = session.user.id;

    // Step 2: Verify user exists in database
    const dbUser = await getUserById(userId);

    if (!dbUser) {
      return createErrorResponse('User not found in database', 403);
    }

    // Step 3: Look up the deployment by deployment ID
    const deployment = await getModelDeploymentById(deploymentId) as ModelDeployment | null;

    if (!deployment) {
      return createErrorResponse(`Deployment not found for deployment ID: ${deploymentId}`, 404);
    }

    // Step 4: Verify user access to the deployment
    if (!await canUserAccessDeployment(deployment, userId)) {
      return createErrorResponse('Unauthorized - You do not have access to this deployment', 403);
    }

    // Step 5: Validate deployment is ready
    const validation = validateDeployment(deployment);
    if (!validation.isValid) {
      return createErrorResponse(validation.error || 'Deployment is not available', 503);
    }

    // Step 6: Handle chat completions 
    if (isChatCompletionsEndpoint(path) && request.method === 'POST') {
      console.log(`[vLLM Deployment Proxy] Using AI SDK for chat completions - deployment: ${deploymentId}`);
      return await handleChatCompletions(request, deployment, userId);
    }

    // For other endpoints (models, completions, embeddings), proxy to vLLM
    const vllmPath = `/v1/${path.join('/')}`;
    const targetUrl = `${deployment.endpointUrl}${vllmPath}`;
    
    console.log(`[vLLM Deployment Proxy] Proxying ${request.method} to: ${targetUrl}`);
    
    const proxyResponse = await fetch(targetUrl, {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: request.method !== 'GET' && request.method !== 'HEAD' 
        ? await request.text() 
        : undefined,
    });

    return new Response(proxyResponse.body, {
      status: proxyResponse.status,
      headers: {
        'Content-Type': proxyResponse.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch (error) {
    console.error('vLLM Deployment Proxy error:', error);
    return createErrorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
}

// Export handlers for all HTTP methods
export async function GET(
  request: Request,
  context: { params: Promise<{ deploymentId: string; path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ deploymentId: string; path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ deploymentId: string; path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ deploymentId: string; path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ deploymentId: string; path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function OPTIONS(
  request: Request,
  context: { params: Promise<{ deploymentId: string; path: string[] }> }
) {
  // Handle CORS preflight requests
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

