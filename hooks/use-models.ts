import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const USE_LOCAL_TEST_DEPLOYMENTS =
  process.env.NEXT_PUBLIC_USE_LOCAL_TEST_DEPLOYMENTS === 'true';
const DEPLOYMENTS_COLLECTION_ENDPOINT = USE_LOCAL_TEST_DEPLOYMENTS
  ? '/api/test/local/deployments'
  : '/api/models/deployments';
const DEPLOYMENTS_LAUNCH_ENDPOINT = USE_LOCAL_TEST_DEPLOYMENTS
  ? '/api/test/local/deployments'
  : '/api/deployments';
const deploymentItemEndpoint = (deploymentId: string) =>
  USE_LOCAL_TEST_DEPLOYMENTS
    ? `/api/test/local/deployments/${deploymentId}`
    : `/api/models/deployments/${deploymentId}`;
const deploymentLogsEndpoint = (deploymentId: string, tail = 200) =>
  USE_LOCAL_TEST_DEPLOYMENTS
    ? `/api/test/local/deployments/${deploymentId}/logs?tail=${tail}`
    : `/api/models/deployments/${deploymentId}/logs?tail=${tail}`;

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
  status: 'warm' | 'cold';
  type: 'Small' | 'Medium' | 'Large';
  family: string;
  variant: string;
  specs: ModelSpecs;
  huggingfaceId?: string; // HuggingFace model ID (e.g., "Qwen/Qwen3-8B")
}

// Matches ModelDeployment table in lib/db/schema.ts
export interface ModelDeployment {
  id: string;
  modelId: string;
  modelName: string;
  userId: string;
  slurmJobId: string;
  status:
    | 'pending'
    | 'launching'
    | 'ready'
    | 'running'
    | 'failed'
    | 'shutdown'
    | 'completed';
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
      const url = query
        ? `/api/models?query=${encodeURIComponent(query)}`
        : '/api/models';
      const res = await fetch(url);

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(
          errorData.error || `Failed to fetch models: ${res.statusText}`,
        );
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
    mutationFn: async (): Promise<{
      success: boolean;
      models: ModelInfo[];
    }> => {
      const res = await fetch('/api/models', {
        method: 'POST',
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(
          errorData.error || `Failed to refresh models: ${res.statusText}`,
        );
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
      const res = await fetch(DEPLOYMENTS_COLLECTION_ENDPOINT);

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
      if (
        !oldData ||
        !Array.isArray(oldData) ||
        !newData ||
        !Array.isArray(newData)
      ) {
        return newData;
      }

      // Type guard to check if arrays contain ModelDeployment objects
      const isModelDeploymentArray = (
        arr: unknown[],
      ): arr is ModelDeployment[] => {
        return arr.every(
          (item) =>
            typeof item === 'object' &&
            item !== null &&
            'id' in item &&
            'modelId' in item &&
            'status' in item,
        );
      };

      if (
        !isModelDeploymentArray(oldData) ||
        !isModelDeploymentArray(newData)
      ) {
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
    },
  });
}

// Launch a model
export function useLaunchModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      modelId: string;
      huggingfaceId?: string;
      family?: string;
    }): Promise<ModelDeployment> => {
      // Construct HuggingFace model ID if not provided
      // Most HF model paths follow pattern: Organization/ModelName
      // For common families, we can derive the organization from family:
      // - Qwen3 -> Qwen/Qwen3-8B
      // - Llama -> meta-llama/Llama-3.1-8B
      // - Mistral -> mistralai/Mistral-7B-v0.3
      let hfModel = params.huggingfaceId;
      if (!hfModel && params.family && params.modelId) {
        // Map model family to HuggingFace organization
        const familyToOrg: Record<string, string> = {
          Qwen: 'Qwen',
          Qwen2: 'Qwen',
          'Qwen2.5': 'Qwen',
          Qwen3: 'Qwen',
          Llama: 'meta-llama',
          'Llama-3': 'meta-llama',
          'Llama-3.1': 'meta-llama',
          'Llama-3.2': 'meta-llama',
          Mistral: 'mistralai',
          CodeLlama: 'meta-llama',
          Gemma: 'google',
          'Gemma-2': 'google',
          Phi: 'microsoft',
          'Phi-3': 'microsoft',
          'c4ai-command-r': 'CohereLabs',
        };
        const org = familyToOrg[params.family] || params.family;
        hfModel = `${org}/${params.modelId}`;
      }

      const res = await fetch(DEPLOYMENTS_LAUNCH_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          modelId: params.modelId,
          hf_model: hfModel || params.modelId, // Use constructed HF model ID
        }),
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
      const res = await fetch(deploymentItemEndpoint(deploymentId), {
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

// Deployment logs response type
export interface DeploymentLogsResponse {
  success: boolean;
  logs: {
    stderr: string[];
    stdout: string[];
  };
  deployment: {
    id: string;
    status: string;
    modelName: string;
    slurmJobId: string;
    errorMessage: string | null;
  };
  logFiles: {
    stderr: string;
    stdout: string;
  };
  error?: string;
}

// Fetch deployment logs with polling
export function useDeploymentLogs(deploymentId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['deploymentLogs', deploymentId],
    queryFn: async (): Promise<DeploymentLogsResponse> => {
      if (!deploymentId) {
        throw new Error('Deployment ID is required');
      }
      const res = await fetch(deploymentLogsEndpoint(deploymentId, 200));

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch logs');
      }

      return res.json();
    },
    enabled: !!deploymentId && enabled,
    refetchInterval: 2000, // Poll every 2 seconds for real-time logs
    staleTime: 1000,
    gcTime: 30000,
  });
}

// Get a single deployment by ID
export function useDeployment(deploymentId: string | null) {
  return useQuery({
    queryKey: ['deployment', deploymentId],
    queryFn: async (): Promise<ModelDeployment> => {
      if (!deploymentId) {
        throw new Error('Deployment ID is required');
      }
      const res = await fetch(deploymentItemEndpoint(deploymentId));

      if (!res.ok) {
        throw new Error('Failed to fetch deployment');
      }

      return res.json();
    },
    enabled: !!deploymentId,
    refetchInterval: 3000, // Poll every 3 seconds for status updates
    staleTime: 2000,
  });
}
