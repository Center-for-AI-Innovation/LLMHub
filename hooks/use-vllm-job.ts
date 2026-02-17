/**
 * Hook for managing vLLM job ID for the proxy
 * 
 * This hook fetches the vLLM job ID from the ModelDeployment table.
 * It returns the job ID of the user's active deployment.
 */

import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const VLLM_JOB_QUERY_KEY = ['vllm-job'] as const;

const fetchVllmJob = async (): Promise<VllmJobResponse> => {
  const response = await fetch('/api/v1/vllm/job', { cache: 'no-store' });

  if (!response.ok) {
    const errorMessage = `Failed to fetch vLLM job: ${response.status}`;
    throw new Error(errorMessage);
  }

  return response.json();
};

interface VllmJobResponse {
  jobId: string | null;
  deploymentId?: string;
  modelId?: string;
  proxyUrl?: string;
  endpointUrl?: string;
  modelName?: string;
  status?: string;
  expiresAt?: string;
  createdAt?: string;
  error?: string;
  message?: string;
}

/**
 * Hook for managing the vLLM job ID
 * 
 * Fetches the job ID from the user's active ModelDeployment.
 * 
 * @returns Object with jobId, deployment info, refresh function, and loading state
 */
export function useVllmJob() {
  const queryClient = useQueryClient();
  const { data, error, isLoading } = useQuery({
    queryKey: VLLM_JOB_QUERY_KEY,
    queryFn: fetchVllmJob,
    // Always refetch quickly so chat does not reuse stale job IDs.
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 1,
  });

  const refreshJobMutation = useMutation({
    mutationFn: async (): Promise<VllmJobResponse> => {
      const response = await fetch('/api/v1/vllm/job', {
        method: 'POST',
      });

      if (!response.ok) {
        const errorMessage = `Failed to refresh vLLM job: ${response.status}`;
        throw new Error(errorMessage);
      }

      return response.json();
    },
    onSuccess: (newData) => {
      queryClient.setQueryData(VLLM_JOB_QUERY_KEY, newData);
    },
  });

  const jobId = data?.jobId || null;
  const deploymentId = data?.deploymentId || null;
  const modelId = data?.modelId || null;
  const proxyUrl = data?.proxyUrl || null;
  const endpointUrl = data?.endpointUrl || null;
  const modelName = data?.modelName || null;
  const status = data?.status || null;
  const expiresAt = data?.expiresAt || null;

  // Function to refresh/revalidate the deployment info
  const refreshJobId = useCallback(async () => {
    return refreshJobMutation.mutateAsync();
  }, [refreshJobMutation]);

  // Check if there's an active deployment
  const hasActiveDeployment = jobId !== null && (status === 'ready' || status === 'running');

  return {
    jobId,
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
    refreshJobId,
  };
}

/**
 * Get the API endpoint for vLLM chat based on the job ID
 * 
 * @param jobId - The Slurm job ID
 * @returns The API endpoint URL
 */
export function getVllmChatEndpoint(jobId: string): string {
  return `/api/v1/job/${jobId}/chat/completions`;
}

/**
 * Get the API endpoint for vLLM models based on the job ID
 * 
 * @param jobId - The Slurm job ID
 * @returns The API endpoint URL
 */
export function getVllmModelsEndpoint(jobId: string): string {
  return `/api/v1/job/${jobId}/models`;
}
