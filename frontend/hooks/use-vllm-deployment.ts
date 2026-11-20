/**
 * Get the API endpoint for vLLM chat based on the deployment ID
 *
 * @param deploymentId - The deployment ID
 * @returns The API endpoint URL
 */
export function getVllmChatEndpoint(deploymentId: string): string {
  return `/api/v1/deployment/${deploymentId}/chat/completions`;
}

/**
 * Get the API endpoint for vLLM models based on the deployment ID
 *
 * @param deploymentId - The deployment ID
 * @returns The API endpoint URL
 */
export function getVllmModelsEndpoint(deploymentId: string): string {
  return `/api/v1/deployment/${deploymentId}/models`;
}
