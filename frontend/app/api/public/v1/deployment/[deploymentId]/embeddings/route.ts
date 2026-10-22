/**
 * Public Embeddings Route (OpenAI-compatible)
 *
 * POST /api/public/v1/deployment/{deploymentId}/embeddings
 *
 * Proxies embedding requests (e.g. {"model": "...", "input": "..."}) to the
 * deployment's /v1/embeddings endpoint and returns the JSON response as-is.
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
  return proxyPublicDeploymentEndpoint(request, deploymentId, 'embeddings');
}

export async function OPTIONS() {
  return publicCorsPreflight();
}
