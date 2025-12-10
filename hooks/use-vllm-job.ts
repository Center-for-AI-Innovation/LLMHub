/**
 * Hook for managing vLLM job ID for the proxy
 * 
 * This hook fetches or creates a vLLM job ID from the database.
 * In development mode, it creates test job IDs.
 * In production, it fetches from the user's active deployments.
 */

import { useState, useEffect, useCallback } from 'react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(res => res.json());

interface VllmJobResponse {
  jobId: string | null;
  chatId?: string;
  proxyUrl?: string;
  endpointUrl?: string;
  modelName?: string;
  status?: string;
  isTest?: boolean;
  error?: string;
}

/**
 * Hook for managing the vLLM job ID
 * 
 * Fetches the job ID from the database or creates a test job in development mode.
 * 
 * @returns Object with jobId, refresh function, and loading state
 */
export function useVllmJob() {
  const { data, error, isLoading, mutate } = useSWR<VllmJobResponse>(
    '/api/v1/vllm/job',
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      // Cache for 5 minutes
      dedupingInterval: 300000,
    }
  );

  const jobId = data?.jobId || null;
  const proxyUrl = data?.proxyUrl || null;
  const endpointUrl = data?.endpointUrl || null;
  const modelName = data?.modelName || null;
  const isTest = data?.isTest || false;

  // Function to refresh/regenerate the job ID
  const refreshJobId = useCallback(async () => {
    const response = await fetch('/api/v1/vllm/job', {
      method: 'POST',
    });
    const newData = await response.json();
    mutate(newData, false);
    return newData;
  }, [mutate]);

  // Function to clear the job ID
  const clearJobId = useCallback(async () => {
    await fetch('/api/v1/vllm/job', {
      method: 'DELETE',
    });
    mutate({ jobId: null }, false);
  }, [mutate]);

  return {
    jobId,
    proxyUrl,
    endpointUrl,
    modelName,
    isLoading,
    isTest,
    error: error?.message || data?.error,
    refreshJobId,
    clearJobId,
  };
}

/**
 * Get the API endpoint for vLLM chat based on the job ID
 * 
 * @param jobId - The Slurm job ID (or test job ID)
 * @returns The API endpoint URL
 */
export function getVllmChatEndpoint(jobId: string): string {
  return `/api/v1/job/${jobId}/chat/completions`;
}

/**
 * Get the API endpoint for vLLM models based on the job ID
 * 
 * @param jobId - The Slurm job ID (or test job ID)
 * @returns The API endpoint URL
 */
export function getVllmModelsEndpoint(jobId: string): string {
  return `/api/v1/job/${jobId}/models`;
}
