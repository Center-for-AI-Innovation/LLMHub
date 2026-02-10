/**
 * Hook for managing vLLM job ID for the proxy
 * 
 * This hook fetches the vLLM job ID from the ModelDeployment table.
 * It returns the job ID of the user's active deployment.
 */

import { useCallback } from 'react';
import useSWR from 'swr';

const fetcher = (url: string) =>
  fetch(url, { cache: 'no-store' }).then((res) => res.json());

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
  const { data, error, isLoading, mutate } = useSWR<VllmJobResponse>(
    '/api/v1/vllm/job',
    fetcher,
    {
      // Always revalidate on mount so chat never reuses an old job id.
      revalidateOnMount: true,
      revalidateIfStale: true,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 1000,
      focusThrottleInterval: 1000,
    }
  );

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
    const response = await fetch('/api/v1/vllm/job', {
      method: 'POST',
    });
    const newData = await response.json();
    mutate(newData, false);
    return newData;
  }, [mutate]);

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
