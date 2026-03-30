/**
 * Public Chat Completions Route (OpenAI-compatible)
 *
 * POST /api/public/v1/job/{jobId}/chat/completions
 *
 * Security:
 * 1. Requires Authorization: Bearer <llmhub_api_key>
 * 2. Verifies the API key belongs to a valid user
 * 3. Verifies the user has access to the deployment
 * 4. Verifies deployment is ready/running
 * 5. Proxies request body as-is to vLLM /v1/chat/completions
 */

import { canUserAccessDeployment } from '@/lib/auth/validate-request';
import { getModelDeploymentByJobId } from '@/lib/db/queries';
import {
  extractBearerApiKey,
  getUserFromApiKey,
} from '@/lib/security/api-keys';
import { createErrorResponse, validateDeployment } from '@/lib/utils';
import type { ModelDeployment } from '@/hooks/use-models';

export const maxDuration = 60;

function getTargetUrl(endpointUrl: string) {
  const cleanEndpoint = endpointUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
  return `${cleanEndpoint}/v1/chat/completions`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const apiKey = extractBearerApiKey(request.headers.get('authorization'));
    if (!apiKey) {
      return createErrorResponse('Unauthorized - API key is required', 401);
    }

    const apiUser = await getUserFromApiKey(apiKey);
    if (!apiUser) {
      return createErrorResponse('Unauthorized - Invalid API key', 401);
    }

    const { jobId } = await params;

    const deployment = (await getModelDeploymentByJobId(
      jobId,
    )) as ModelDeployment | null;
    if (!deployment) {
      return createErrorResponse(`Deployment not found for job ID: ${jobId}`, 404);
    }

    if (!(await canUserAccessDeployment(deployment, apiUser.id))) {
      return createErrorResponse(
        'Unauthorized - You do not have access to this deployment',
        403,
      );
    }

    const validation = validateDeployment(deployment);
    if (!validation.isValid) {
      return createErrorResponse(
        validation.error || 'Deployment is not available',
        503,
      );
    }

    if (!deployment.endpointUrl) {
      return createErrorResponse('Deployment endpoint is unavailable', 503);
    }

    const targetUrl = getTargetUrl(deployment.endpointUrl);
    const requestBody = await request.text();

    const proxyResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type':
          request.headers.get('content-type') || 'application/json',
        Accept: request.headers.get('accept') || 'application/json',
      },
      body: requestBody,
    });

    const responseHeaders = new Headers();
    const contentType = proxyResponse.headers.get('content-type');
    if (contentType) {
      responseHeaders.set('Content-Type', contentType);
    }

    return new Response(proxyResponse.body, {
      status: proxyResponse.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('[Public Chat Completions] Proxy error:', error);
    return createErrorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500,
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}
