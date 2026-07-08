/** SLURM partition -> vec-inf resource_type for Delta launches. */
export const PARTITION_RESOURCE_TYPE: Record<string, string> = {
  gpuA40x4: 'nvidia_a40',
  'gpuA40x4-interactive': 'nvidia_a40',
  'gpuA40x4-preempt': 'nvidia_a40',
  gpuA100x4: 'A100',
  'gpuA100x4-interactive': 'A100',
  'gpuA100x4-preempt': 'A100',
  gpuA100x8: 'A100',
  'gpuA100x8-interactive': 'A100',
  gpuH200x8: 'H100',
  'gpuH200x8-interactive': 'H100',
};

export const LAUNCH_PARTITIONS = [
  'gpuA40x4',
  'gpuA100x4',
  'gpuA100x8',
  'gpuH200x8',
  'gpuA40x4-preempt',
  'gpuA100x4-preempt',
] as const;

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

export function worstCaseKvTokens(
  contextLength: number,
  concurrency: number,
): number {
  return contextLength * concurrency;
}

export function formatFitConfigSummary(
  contextLength: number,
  concurrency: number,
  numGpus: number,
): string {
  const kvBudget = worstCaseKvTokens(contextLength, concurrency);
  return `Context ${contextLength.toLocaleString()} · Concurrency ${concurrency} · ${numGpus} GPU${numGpus > 1 ? 's' : ''} (worst-case KV: ${kvBudget.toLocaleString()} tokens)`;
}

export function formatFitVerdict(
  fits: boolean | null | undefined,
  partition: string,
  headroomGib: number | null | undefined,
): { title: string; detail: string; tone: 'success' | 'error' | 'pending' } {
  if (fits === true) {
    return {
      tone: 'success',
      title: `Will run on ${partition}`,
      detail:
        headroomGib != null
          ? `Estimated ${headroomGib.toFixed(1)} GiB headroom per GPU after weights, KV cache, and framework overhead.`
          : 'This configuration fits within per-GPU memory under a worst-case KV assumption.',
    };
  }
  if (fits === false) {
    return {
      tone: 'error',
      title: `Will not run on ${partition}`,
      detail:
        'Worst-case KV cache for this context length and concurrency exceeds available GPU memory. Try a shorter context, lower concurrency, more GPUs, or a larger partition. Typical workload factors are advisory only and do not gate launch.',
    };
  }
  return {
    tone: 'pending',
    title: 'Checking fit…',
    detail: 'Estimating memory for your context length and concurrency.',
  };
}
