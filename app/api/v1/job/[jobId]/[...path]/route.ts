/**
 * vLLM Proxy Route Handler
 * 
 * This catch-all route handler proxies authenticated requests to vLLM instances
 * running on Slurm worker nodes. It supports all OpenAI-compatible endpoints:
 * 
 * - /api/v1/job/{jobId}/chat/completions -> {endpointUrl}/v1/chat/completions
 * - /api/v1/job/{jobId}/completions -> {endpointUrl}/v1/completions
 * - /api/v1/job/{jobId}/embeddings -> {endpointUrl}/v1/embeddings
 * - /api/v1/job/{jobId}/models -> {endpointUrl}/v1/models
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
import { getUserById, getVllmJobByJobId } from '@/lib/db/queries';
import {
  getDeploymentByJobId,
  validateDeployment,
  userOwnsDeployment,
  createErrorResponse,
  isTestJobId,
} from '@/lib/vllm-proxy';
import {
  isChatCompletionsEndpoint,
  handleChatCompletions,
} from '@/lib/vllm-ai-sdk';

export const maxDuration = 60;

/**
 * Common handler for all HTTP methods
 */
async function handleRequest(
  request: Request,
  { params }: { params: Promise<{ jobId: string; path: string[] }> }
): Promise<Response> {
  try {
    const { jobId, path } = await params;

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

    // Step 3: Look up the deployment by Slurm job ID
    // Pass userId for test deployments (job IDs starting with "test-")
    const deployment = await getDeploymentByJobId(jobId, userId);

    if (!deployment) {
      return createErrorResponse(`Deployment not found for job ID: ${jobId}`, 404);
    }

    // Step 4: Verify user owns the deployment
    // Skip ownership check for test deployments (they're created with the current user's ID)
    if (!isTestJobId(jobId)) {
      // First check backend deployment ownership
      if (!userOwnsDeployment(deployment, userId)) {
        // Also check frontend VllmChatJob table for ownership
        try {
          const chatJob = await getVllmJobByJobId({ slurmJobId: jobId });
          if (!chatJob || chatJob.userId !== userId) {
            return createErrorResponse('Unauthorized - You do not have access to this deployment', 403);
          }
          console.log(`[vLLM Proxy] Job ownership verified via VllmChatJob table for job: ${jobId}`);
        } catch {
          // If table doesn't exist or query fails, fall back to deployment ownership check
          return createErrorResponse('Unauthorized - You do not have access to this deployment', 403);
        }
      }
    }

    // Step 5: Validate deployment is ready
    const validation = validateDeployment(deployment);
    if (!validation.isValid) {
      return createErrorResponse(validation.error || 'Deployment is not available', 503);
    }

    // Step 6: Handle chat completions specially using AI SDK
    // Only use AI SDK format when the x-ai-sdk header is present (from useChat hook)
    // Direct API calls without this header get standard OpenAI-compatible responses
    if (isChatCompletionsEndpoint(path) && request.method === 'POST') {
      console.log(`[vLLM Job Proxy] Using AI SDK for chat completions - job: ${jobId}`);
      return await handleChatCompletions(request, deployment, userId);
    }
  } catch (error) {
    console.error('vLLM Proxy error:', error);
    return createErrorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
}

// Export handlers for all HTTP methods
export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string; path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string; path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ jobId: string; path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ jobId: string; path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ jobId: string; path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function OPTIONS(
  request: Request,
  context: { params: Promise<{ jobId: string; path: string[] }> }
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

