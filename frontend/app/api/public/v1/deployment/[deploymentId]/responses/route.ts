/**
 * Public Responses Route (OpenAI-compatible)
 *
 * POST /api/public/v1/deployment/{deploymentId}/responses
 *
 * Proxies Responses API requests (e.g. {"model": "...", "input": "..."}) to
 * the deployment's /v1/responses endpoint. The upstream response is passed
 * through as-is: a JSON response object, or an SSE event stream when
 * "stream": true is requested.
 *
 * Stateless only: vLLM's response store is not enabled, so `store` is
 * ignored and `previous_response_id`, `background`, and the retrieve/cancel
 * endpoints are not available. Continue a conversation by sending it again
 * as `input`. See issue #127.
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
  return proxyPublicDeploymentEndpoint(request, deploymentId, 'responses');
}

export async function OPTIONS() {
  return publicCorsPreflight();
}
