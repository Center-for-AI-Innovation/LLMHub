/**
 * Public Chat Completions Route (OpenAI-compatible)
 *
 * POST /api/public/v1/deployment/{deploymentId}/chat/completions
 *
 * Proxies chat completions requests (e.g. {"model": "...", "messages": [...]})
 * to the deployment's /v1/chat/completions endpoint. The upstream response is
 * passed through as-is: a JSON completion, or an SSE event stream when
 * "stream": true is requested.
 *
 * See @/lib/public-deployment-proxy for the auth/authorization chain and
 * proxy behavior.
 */

import {
  proxyPublicDeploymentEndpoint,
  publicCorsPreflight,
} from '@/lib/public-deployment-proxy';

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ deploymentId: string }> },
) {
  const { deploymentId } = await params;
  return proxyPublicDeploymentEndpoint(
    request,
    deploymentId,
    'chat/completions',
  );
}

export async function OPTIONS() {
  return publicCorsPreflight();
}
