/** SLURM partition -> vec-inf resource_type for Delta launches. */
export const PARTITION_RESOURCE_TYPE: Record<string, string> = {
  gpuA40x4: 'nvidia_a40',
  'gpuA40x4-preempt': 'nvidia_a40',
  gpuA100x4: 'A100',
  'gpuA100x4-preempt': 'A100',
  gpuA100x8: 'A100',
  gpuH200x8: 'H200',
};

export const LAUNCH_PARTITIONS = [
  'gpuA40x4',
  'gpuA100x4',
  'gpuA100x8',
  'gpuH200x8',
  'gpuA40x4-preempt',
  'gpuA100x4-preempt',
] as const;

export type LaunchPartition = (typeof LAUNCH_PARTITIONS)[number];

export interface LaunchConfig {
  time: string;
  partition: LaunchPartition;
  resource_type: string;
  max_model_len: number;
  /** Omitted when the catalog's existing scheduler cap should be preserved. */
  max_num_seqs?: number;
  num_gpus: number;
}

export function isLaunchPartition(
  partition: string,
): partition is LaunchPartition {
  return (LAUNCH_PARTITIONS as readonly string[]).includes(partition);
}

export const GPU_COUNT_OPTIONS = [1, 2, 4, 8] as const;

/** vLLM built-in default when catalog omits ``--max-num-seqs``. */
export const VLLM_DEFAULT_MAX_NUM_SEQS = 256;

/** Max tensor-parallel size allowed on a Delta partition (GPUs per node). */
export function maxGpusForPartition(partition: string): number {
  const match = partition.match(/x(\d+)(?:-|$)/);
  return match ? parseInt(match[1], 10) : 4;
}

export function allowedGpuOptionsForPartition(partition: string): number[] {
  const max = maxGpusForPartition(partition);
  return GPU_COUNT_OPTIONS.filter((n) => n <= max);
}

export function clampGpuCount(gpus: number, partition: string): number {
  const max = maxGpusForPartition(partition);
  const allowed = allowedGpuOptionsForPartition(partition);
  if (gpus <= max && allowed.includes(gpus)) {
    return gpus;
  }
  return allowed.reduce(
    (best, n) => (n <= gpus && n > best ? n : best),
    allowed[0],
  );
}

export function resourceTypeForPartition(partition: string): string {
  return PARTITION_RESOURCE_TYPE[partition] ?? 'nvidia_a40';
}

export function formatDuration(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
}

export function formatSu(su: number): string {
  return su.toLocaleString();
}

export function formatSuBreakdown(
  suPerGpuHour: number,
  numGpus: number,
  durationHours: number,
  totalSu: number,
): string {
  const jobSuPerHour = suPerGpuHour * numGpus;
  const durationLabel =
    durationHours >= 1
      ? `${durationHours % 1 === 0 ? durationHours : durationHours.toFixed(2)} hr`
      : `${Math.round(durationHours * 60)} min`;
  return `${formatSu(jobSuPerHour)} SU/hr (${formatSu(suPerGpuHour)}/GPU × ${numGpus}) × ${durationLabel} = ${formatSu(totalSu)} SU`;
}

export function durationHoursFromParts(hours: number, minutes: number): number {
  return hours + minutes / 60;
}

/** Default expected average sequence length for the capacity estimate. */
export const DEFAULT_TYPICAL_SEQ_LEN = 4096;

const GIB = 2 ** 30;

export interface FitBreakdown {
  weights_gib: number | null;
  overhead_gib: number;
  kv_pool_required_gib?: number | null;
}

/** Partition row fields used to derive or display KV capacity. */
export interface PartitionCapacityInput {
  vram_gib: number;
  starts?: boolean | null;
  kv_pool_tokens?: number | null;
  concurrent_at_full_context?: number | null;
  concurrent_at_typical?: number | null;
  breakdown?: FitBreakdown;
}

export interface ResolvedPartitionCapacity {
  starts: boolean | null;
  kvPoolTokens: number | null;
  concurrentAtFullContext: number | null;
  concurrentAtTypical: number | null;
}

/**
 * Use API capacity fields when present; otherwise derive from the per-partition
 * breakdown (covers stale backends that omit ``starts``).
 */
export function resolvePartitionCapacity(
  fit: PartitionCapacityInput,
  opts: {
    perTokenKvBytes: number | null | undefined;
    maxModelLen: number;
    typicalSeqLen: number;
    maxNumSeqs: number;
  },
): ResolvedPartitionCapacity {
  if (fit.starts != null) {
    return {
      starts: fit.starts,
      kvPoolTokens: fit.kv_pool_tokens ?? null,
      concurrentAtFullContext: fit.concurrent_at_full_context ?? null,
      concurrentAtTypical: fit.concurrent_at_typical ?? null,
    };
  }

  const weights = fit.breakdown?.weights_gib;
  const overhead = fit.breakdown?.overhead_gib;
  const perToken = opts.perTokenKvBytes;
  if (
    weights == null ||
    overhead == null ||
    perToken == null ||
    perToken <= 0
  ) {
    return {
      starts: null,
      kvPoolTokens: null,
      concurrentAtFullContext: null,
      concurrentAtTypical: null,
    };
  }

  const kvPoolGib = fit.vram_gib - weights - overhead;
  if (kvPoolGib <= 0) {
    return {
      starts: false,
      kvPoolTokens: 0,
      concurrentAtFullContext: 0,
      concurrentAtTypical: 0,
    };
  }

  const poolTokens = Math.floor((kvPoolGib * GIB) / perToken);
  const starts = poolTokens >= opts.maxModelLen;
  const effTypical = Math.max(
    1,
    Math.min(opts.typicalSeqLen, opts.maxModelLen),
  );
  const concFull = Math.min(
    opts.maxNumSeqs,
    Math.floor(poolTokens / opts.maxModelLen),
  );
  const concTypical = Math.min(
    opts.maxNumSeqs,
    Math.floor(poolTokens / effTypical),
  );

  return {
    starts,
    kvPoolTokens: poolTokens,
    concurrentAtFullContext: starts ? concFull : 0,
    concurrentAtTypical: starts ? concTypical : 0,
  };
}

export function formatFitConfigSummary(
  contextLength: number,
  concurrencyCap: number,
  numGpus: number,
  typicalSeqLen: number,
): string {
  return `Context ${contextLength.toLocaleString()} · up to ${concurrencyCap} concurrent · ~${typicalSeqLen.toLocaleString()} typical tokens · ${numGpus} GPU${numGpus > 1 ? 's' : ''}`;
}

export interface CapacityVerdictInput {
  starts: boolean | null | undefined;
  partition: string;
  contextLength: number;
  typicalSeqLen: number;
  concurrentAtFullContext: number | null | undefined;
  concurrentAtTypical: number | null | undefined;
  kvPoolTokens: number | null | undefined;
}

/**
 * Capacity-model verdict. vLLM allocates a fixed KV pool at startup and queues
 * (never OOMs) beyond it, so the only hard block is "won't start"; concurrency
 * is reported as sustainable capacity, not a pass/fail on a saturation product.
 */
export function formatCapacityVerdict(input: CapacityVerdictInput): {
  title: string;
  detail: string;
  tone: 'success' | 'error' | 'pending';
} {
  const {
    starts,
    partition,
    contextLength,
    typicalSeqLen,
    concurrentAtFullContext,
    concurrentAtTypical,
    kvPoolTokens,
  } = input;

  if (starts === false) {
    return {
      tone: 'error',
      title: `Won't start on ${partition}`,
      detail: `The KV pool can't hold even one sequence at ${contextLength.toLocaleString()} tokens after weights and overhead. Reduce the context length, add GPUs, or pick a larger-VRAM partition.`,
    };
  }

  if (starts === true) {
    const full = concurrentAtFullContext ?? 0;
    const typical = concurrentAtTypical ?? 0;
    const poolNote =
      kvPoolTokens != null
        ? ` KV pool holds ~${kvPoolTokens.toLocaleString()} tokens.`
        : '';
    return {
      tone: 'success',
      title: `Starts on ${partition}`,
      detail: `Sustains ~${full} concurrent request${full === 1 ? '' : 's'} at the full ${contextLength.toLocaleString()}-token context, or ~${typical} at ~${typicalSeqLen.toLocaleString()} tokens each. Beyond that vLLM queues (it won't crash).${poolNote}`,
    };
  }

  return {
    tone: 'pending',
    title: 'Checking capacity…',
    detail: 'Sizing the KV pool for your context length and GPU count.',
  };
}
