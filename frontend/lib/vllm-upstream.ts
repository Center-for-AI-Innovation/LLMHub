import 'server-only';

import { getDeploymentUpstreamKey } from '@/lib/db/queries';

/**
 * Headers that authenticate a forwarded request to a deployment's vLLM server.
 *
 * Each deployment's vLLM requires its own key, which only these proxy routes
 * know: users authenticate to LLMHub, and LLMHub authenticates to vLLM.
 * Deployments launched before keys existed have none and accept requests
 * without one.
 */
export async function upstreamAuthHeaders(
  deploymentId: string,
): Promise<Record<string, string>> {
  const key = await getDeploymentUpstreamKey(deploymentId);
  return key ? { Authorization: `Bearer ${key}` } : {};
}
