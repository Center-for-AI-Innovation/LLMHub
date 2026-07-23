import { useQuery } from '@tanstack/react-query';

export interface FitEstimateRequest {
  model_id: string;
  model_family?: string;
  huggingface_id?: string;
  max_model_len?: number;
  max_num_seqs?: number;
  typical_seq_len?: number;
  tensor_parallel_size?: number;
  time?: string;
  duration_hours?: number;
  kv_assumption?: 'worst_case' | 'typical';
}

export interface PartitionFit {
  partition: string;
  gpu_type: string;
  vendor: string;
  vram_gib: number;
  supported: boolean;
  skipped_reason: string | null;
  fits: boolean | null;
  headroom_gib: number | null;
  breakdown?: {
    weights_gib: number | null;
    overhead_gib: number;
    kv_pool_required_gib?: number | null;
  };
  su_per_gpu_hour: number | null;
  effective_su_per_hour: number | null;
  estimated_job_su: number | null;
  starts: boolean | null;
  kv_pool_gib: number | null;
  kv_pool_tokens: number | null;
  concurrent_at_full_context: number | null;
  concurrent_at_typical: number | null;
}

export interface FitEstimateResponse {
  max_model_len: number;
  max_num_seqs: number;
  tensor_parallel_size: number;
  duration_hours: number | null;
  cheapest_feasible_partition: string | null;
  typical_seq_len: number | null;
  per_token_kv_bytes: number | null;
  warnings: string[];
  partitions: PartitionFit[];
}

export function useFitEstimate(
  request: FitEstimateRequest | null,
  enabled = true,
) {
  return useQuery({
    queryKey: ['fit-estimate', request],
    queryFn: async (): Promise<FitEstimateResponse> => {
      if (!request) {
        throw new Error('Fit estimate request is required');
      }
      const res = await fetch('/api/fit-estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(
          (errorData as { error?: string }).error ||
            `Fit estimate failed (${res.status})`,
        );
      }
      return res.json();
    },
    enabled: enabled && request !== null,
    staleTime: 30_000,
    retry: false,
  });
}
