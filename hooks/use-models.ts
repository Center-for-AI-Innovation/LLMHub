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
  name: string;
  description: string;
  status: 'WARM' | 'COLD' | 'OFFLINE';
  type: 'Small' | 'Medium' | 'Large';
  family: string;
  variant: string;
  specs: ModelSpecs;
}

export interface ModelDeployment {
  id: string;
  modelId: string;
  userId: string;
  status: 'RUNNING' | 'STARTING' | 'FAILED' | 'STOPPED';
  createdAt: string;
  expiresAt?: string;
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
    },
  });
} 