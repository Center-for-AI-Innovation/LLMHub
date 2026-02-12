import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Types for models
export interface ModelSpecs {
  gpus: number;
  nodes: number;
  contextLength: number;
  parallelism: boolean;
}

export interface ModelInfo {
  id: string;
  modelName: string;
  description: string;  
  status: 'warm' | 'cold' ;
  type: 'Small' | 'Medium' | 'Large';
  family: string;
  variant: string;
  specs: ModelSpecs;
}

// Matches ModelDeployment table in lib/db/schema.ts
export interface ModelDeployment {
  id: string;
  modelId: string;
  modelName: string;
  userId: string;
  slurmJobId: string;
  status: 'pending' | 'launching' | 'ready' | 'running' | 'failed' | 'shutdown' | 'completed';
  endpointUrl: string | null;
  errorMessage: string | null;
  resourceAllocation: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

// Fetch all models
export function useModels(query?: string) {
  return useQuery({
    queryKey: ['models', query],
    queryFn: async (): Promise<ModelInfo[]> => {
      const url = query ? `/api/models?query=${encodeURIComponent(query)}` : '/api/models';
      const res = await fetch(url);
      
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `Failed to fetch models: ${res.statusText}`);
      }
      
      const data = await res.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      return data;
    },
    staleTime: 30000, // Cache data for 30 seconds
    gcTime: 300000, // Keep inactive cache for 5 minutes
  });
}

// Fetch a specific model
export function useModel(modelId: string) {
  return useQuery({
    queryKey: ['models', modelId],
    queryFn: async (): Promise<ModelInfo> => {
      const res = await fetch(`/api/models/${modelId}`);
      
      if (!res.ok) {
        throw new Error(`Failed to fetch model: ${res.status}`);
      }
      
      return res.json();
    },
    enabled: !!modelId,
    staleTime: 60000, // Cache data for 1 minute
    gcTime: 300000, // Keep inactive cache for 5 minutes
  });
}

// Refresh models
export function useRefreshModels() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (): Promise<{success: boolean, models: ModelInfo[]}> => {
      const res = await fetch('/api/models', {
        method: 'POST',
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `Failed to refresh models: ${res.statusText}`);
      }
      
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        queryClient.setQueryData(['models'], data.models);
      }
    },
  });
}

// Fetch model deployments
export function useModelDeployments() {
  return useQuery({
    queryKey: ['deployments'],
    queryFn: async (): Promise<ModelDeployment[]> => {
      const res = await fetch('/api/deployments');
      
      if (!res.ok) {
        throw new Error('Failed to fetch deployments');
      }
      
      const data = await res.json();
      // Ensure deployments is always an array
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 10000, // Refetch every 10 seconds to keep deployment status updated
    staleTime: 5000, // Consider data stale after 5 seconds
    gcTime: 60000, // Keep inactive cache for 1 minute
    // Add structuralSharing to prevent unnecessary re-renders when data has not actually changed
    structuralSharing: (oldData: unknown, newData: unknown): unknown => {
      // Type guard to check and cast to ModelDeployment[]
      if (!oldData || !Array.isArray(oldData) || !newData || !Array.isArray(newData)) {
        return newData;
      }
      
      // Type guard to check if arrays contain ModelDeployment objects
      const isModelDeploymentArray = (arr: unknown[]): arr is ModelDeployment[] => {
        return arr.every(item => 
          typeof item === 'object' && 
          item !== null && 
          'id' in item && 
          'modelId' in item && 
          'status' in item
        );
      };
      
      if (!isModelDeploymentArray(oldData) || !isModelDeploymentArray(newData)) {
        return newData;
      }
      
      // Deep comparison of deployment arrays
      if (oldData.length !== newData.length) {
        return newData;
      }
      
      // Check if any deployments have changed their status
      const hasChanged = newData.some((newDeployment, index) => {
        const oldDeployment = oldData[index];
        return (
          newDeployment.id !== oldDeployment.id ||
          newDeployment.status !== oldDeployment.status ||
          newDeployment.modelId !== oldDeployment.modelId
        );
      });
      
      // Return the old reference if nothing has changed to prevent re-renders
      return hasChanged ? newData : oldData;
    }
  });
}

// Launch a model
export function useLaunchModel() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (modelId: string): Promise<ModelDeployment> => {
      const res = await fetch('/api/deployments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ modelId }),
      });
      
      if (!res.ok) {
        throw new Error('Failed to launch model');
      }
      
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deployments'] });
      queryClient.invalidateQueries({ queryKey: ['vllm-job'] });
    },
  });
}

// Stop a model
export function useStopModel() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (deploymentId: string): Promise<void> => {
      const res = await fetch(`/api/deployments/${deploymentId}`, {
        method: 'DELETE',
      });
      
      if (!res.ok) {
        throw new Error('Failed to stop model');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deployments'] });
      queryClient.invalidateQueries({ queryKey: ['vllm-job'] });
    },
  });
} 