/**
 * Hook for managing active vLLM deployment for the proxy
 *
 * This hook fetches the active vLLM deployment from the ModelDeployment table.
 * It returns the deployment ID of the user's active deployment.
 */

import { ModelDeployment } from '@/hooks/use-models';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const VLLM_DEPLOYMENT_QUERY_KEY = ['vllm-deployment'] as const;

interface VllmDeploymentResponse {
  deploymentId?: string | null;
  slurmJobId?: string | null;
  modelId?: string;
  proxyUrl?: string;
  endpointUrl?: string | null;
  modelName?: string;
  status?: ModelDeployment['status'];
  expiresAt?: string | null;
  createdAt?: string | null;
  error?: string | null;
  message?: string | null;
  refreshed?: boolean | null;
}

const fetchVllmDeployment = async (): Promise<VllmDeploymentResponse> => {
  const response = await fetch('/api/v1/vllm/deployment', { cache: 'no-store' });

  if (!response.ok) {
    const errorMessage = `Failed to fetch vLLM deployment: ${response.status}`;
    throw new Error(errorMessage);
  }

  return response.json();
};

/**
 * Hook for managing the active vLLM deployment
 *
 * Fetches the active vLLM deployment from the user's active ModelDeployment.
 *
 * @returns Object with deploymentId, deployment info, refresh function, and loading state
 */
export function useVllmJob(enabled = true) {
  const queryClient = useQueryClient();
  const { data, error, isLoading } = useQuery({
    queryKey: VLLM_DEPLOYMENT_QUERY_KEY,
    queryFn: fetchVllmDeployment,
    // Always refetch quickly so chat does not reuse stale deployment IDs.
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 1,
    enabled,
  });

  const refreshDeploymentMutation = useMutation({
    mutationFn: async (): Promise<VllmDeploymentResponse> => {
      const response = await fetch('/api/v1/vllm/deployment', {
        method: 'POST',
      });

      if (!response.ok) {
        const errorMessage = `Failed to refresh vLLM deployment: ${response.status}`;
        throw new Error(errorMessage);
      }

      return response.json();
    },
    onSuccess: (newData) => {
      queryClient.setQueryData(VLLM_DEPLOYMENT_QUERY_KEY, newData);
    },
    onError: (error) => {
      console.error('[vLLM Deployment] Error refreshing deployment:', error);
    },
  });

  const slurmJobId = data?.slurmJobId || null;
  const deploymentId = data?.deploymentId || null;
  const modelId = data?.modelId || null;
  const proxyUrl = data?.proxyUrl || null;
  const endpointUrl = data?.endpointUrl || null;
  const modelName = data?.modelName || null;
  const status = data?.status || null;
  const expiresAt = data?.expiresAt || null;

  // Function to refresh/revalidate the deployment info
  const refreshDeploymentId = async () => refreshDeploymentMutation.mutateAsync();

  // Check if there's an active deployment
  const hasActiveDeployment =
    deploymentId !== null && (status === 'ready' || status === 'running');

  return {
    slurmJobId,
    deploymentId,
    modelId,
    proxyUrl,
    endpointUrl,
    modelName,
    status,
    isLoading,
    expiresAt,
    hasActiveDeployment,
    error: error?.message || data?.error,
    message: data?.message,
    refreshDeploymentId,
  };
}

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
