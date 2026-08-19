'use client';

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Cpu,
  Gauge,
  HardDrive,
  Layers,
  Loader2,
  Settings2,
  XCircle,
} from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDebounce } from '@/hooks/use-debounce';
import { useFitEstimate } from '@/hooks/use-fit-estimate';
import { resolveHfModelId } from '@/lib/models/huggingface';
import {
  allowedGpuOptionsForPartition,
  clampGpuCount,
  DEFAULT_TYPICAL_SEQ_LEN,
  durationHoursFromParts,
  formatCapacityVerdict,
  formatDuration,
  formatFitConfigSummary,
  formatSu,
  formatSuBreakdown,
  GPU_COUNT_OPTIONS,
  isLaunchPartition,
  LAUNCH_PARTITIONS,
  type LaunchConfig,
  type LaunchPartition,
  maxGpusForPartition,
  resolvePartitionCapacity,
  resourceTypeForPartition,
  VLLM_DEFAULT_MAX_NUM_SEQS,
} from '@/lib/models/launch-config';
import { cn } from '@/lib/utils';

interface LaunchModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelName: string;
  modelId: string;
  huggingfaceId?: string;
  defaultContextLength?: number;
  defaultGpus?: number;
  defaultPartition?: LaunchPartition;
  defaultMaxNumSeqs?: number;
  modelFamily?: string;
  isLaunching: boolean;
  onLaunch: (config: LaunchConfig) => void;
}

function FitStatusIcon({ status }: { status: boolean | null }) {
  if (status === true) {
    return <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />;
  }
  if (status === false) {
    return <XCircle className="size-4 shrink-0 text-destructive" />;
  }
  return <AlertCircle className="size-4 shrink-0 text-muted-foreground" />;
}

/**
 * Accessible range input with a visual track matching the launch dialog.
 */
function TrackSlider({
  label,
  min,
  max,
  step,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onValueChange: (value: number) => void;
  disabled?: boolean;
}) {
  const span = Math.max(1, max - min);
  const pct = (v: number) =>
    ((Math.min(Math.max(v, min), max) - min) / span) * 100;
  const clampedValue = Math.min(Math.max(value, min), max);
  const valuePct = pct(clampedValue);
  return (
    <div
      className={cn(
        'relative flex h-4 items-center',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <div className="absolute inset-x-0 h-1.5 rounded-full bg-muted" />
      <div
        className="absolute h-1.5 rounded-full bg-primary"
        style={{ width: `${valuePct}%` }}
      />
      <div
        className="absolute size-3.5 -translate-x-1/2 rounded-full border-2 border-background bg-primary shadow"
        style={{ left: `${valuePct}%` }}
      />
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={clampedValue}
        disabled={disabled}
        onChange={(e) => onValueChange(Number(e.target.value))}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
    </div>
  );
}

/**
 * Advanced launch dialog: duration, partition, context window, GPUs, and
 * live per-partition fit + SU estimates for the requested walltime.
 */
export function LaunchModelDialog({
  open,
  onOpenChange,
  modelName,
  modelId,
  huggingfaceId,
  defaultContextLength = 4096,
  defaultMaxNumSeqs = VLLM_DEFAULT_MAX_NUM_SEQS,
  defaultGpus = 1,
  defaultPartition = 'gpuA40x4',
  modelFamily,
  isLaunching,
  onLaunch,
}: LaunchModelDialogProps) {
  const [hours, setHours] = React.useState<string>('0');
  const [minutes, setMinutes] = React.useState<string>('30');
  const [partition, setPartition] = React.useState(defaultPartition);
  const [contextLength, setContextLength] = React.useState(
    String(defaultContextLength),
  );
  const [numGpus, setNumGpus] = React.useState(String(defaultGpus));
  const [numSeqs, setNumSeqs] = React.useState(String(defaultMaxNumSeqs));
  const [concurrencyTouched, setConcurrencyTouched] = React.useState(false);
  const [overrideOpen, setOverrideOpen] = React.useState(false);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setPartition(defaultPartition);
      setContextLength(String(defaultContextLength));
      setNumGpus(String(clampGpuCount(defaultGpus, defaultPartition)));
      setNumSeqs(String(defaultMaxNumSeqs));
      setConcurrencyTouched(false);
      setOverrideOpen(false);
    }
  }, [
    open,
    defaultPartition,
    defaultContextLength,
    defaultGpus,
    defaultMaxNumSeqs,
  ]);

  const allowedGpuOptions = allowedGpuOptionsForPartition(partition);
  const partitionGpuCap = maxGpusForPartition(partition);
  const parsedGpus = parseInt(numGpus || '1', 10);
  const parsedNumSeqs = parseInt(numSeqs || '0', 10);
  const effectiveConcurrency = concurrencyTouched
    ? parsedNumSeqs
    : defaultMaxNumSeqs;

  React.useEffect(() => {
    const clamped = clampGpuCount(parsedGpus, partition);
    if (clamped !== parsedGpus) {
      setNumGpus(String(clamped));
    }
  }, [partition, parsedGpus]);

  const h = parseInt(hours || '0', 10);
  const m = parseInt(minutes || '0', 10);
  const isZeroDuration = h === 0 && m === 0;
  const parsedContext = parseInt(contextLength || '0', 10);
  const timeStr = formatDuration(h, m);
  const durationHours = durationHoursFromParts(h, m);

  const hfModelId = resolveHfModelId(modelId, modelFamily, huggingfaceId);

  // Memoized on primitives: a fresh object literal here re-arms useDebounce's
  // effect every render, which re-renders the open dialog every 400ms forever.
  const fitRequest = React.useMemo(
    () =>
      open
        ? {
            model_id: hfModelId,
            model_family: modelFamily,
            huggingface_id: huggingfaceId,
            max_model_len: parsedContext,
            max_num_seqs: effectiveConcurrency,
            typical_seq_len: DEFAULT_TYPICAL_SEQ_LEN,
            tensor_parallel_size: parsedGpus,
            time: timeStr,
          }
        : null,
    [
      open,
      hfModelId,
      modelFamily,
      huggingfaceId,
      parsedContext,
      effectiveConcurrency,
      parsedGpus,
      timeStr,
    ],
  );
  const debouncedFitKey = useDebounce(fitRequest, 400);

  const fitSurveyEnabled =
    open &&
    parsedContext > 0 &&
    parsedNumSeqs > 0 &&
    allowedGpuOptions.includes(parsedGpus);

  const fitEnabled = fitSurveyEnabled && !isZeroDuration;

  const {
    data: fitEstimate,
    isFetching: isFetchingFit,
    error: fitError,
  } = useFitEstimate(debouncedFitKey, fitSurveyEnabled);

  const selectedFit = fitEstimate?.partitions.find(
    (p) => p.partition === partition,
  );
  const effectiveTypicalLen =
    fitEstimate?.typical_seq_len ?? DEFAULT_TYPICAL_SEQ_LEN;
  const capacityOpts = {
    perTokenKvBytes: fitEstimate?.per_token_kv_bytes,
    maxModelLen: fitEstimate?.max_model_len ?? parsedContext,
    typicalSeqLen: effectiveTypicalLen,
    maxNumSeqs: fitEstimate?.max_num_seqs ?? effectiveConcurrency,
  };
  const selectedCapacity = selectedFit
    ? resolvePartitionCapacity(selectedFit, capacityOpts)
    : null;
  // The first estimate for this dialog is still in flight (no data, no error).
  const fitPending = fitSurveyEnabled && isFetchingFit && !fitEstimate;
  // Only a definite "won't start" blocks the launch. When the estimator cannot
  // answer (error, sparse VLM metadata, gated repo without a token) we warn and
  // allow — mirroring the backend launch gate, which skips configs it cannot
  // size rather than blocking curated models. The gate re-validates
  // server-side on submit either way.
  const definiteNoStart = selectedCapacity?.starts === false;
  // SU figures come from the (debounced) response; pair them with the
  // request values the response echoes back, never live input state, so the
  // "X SU/hr x duration = Y SU" string is always internally consistent.
  const estimateGpus = fitEstimate?.tensor_parallel_size ?? parsedGpus;
  const estimateDurationHours = fitEstimate?.duration_hours ?? durationHours;

  // Context determines whether vLLM can start; the scheduler cap is a demoted
  // readout with an explicit override (it reserves no memory and rarely needs
  // changing — see the launch-config verdict helpers).
  const MIN_CONTEXT = 512;
  const modelMaxContext = Math.max(MIN_CONTEXT, defaultContextLength);
  const displayContext = Math.min(
    Math.max(parsedContext || MIN_CONTEXT, MIN_CONTEXT),
    modelMaxContext,
  );

  // Verdict/summary values must all come from the same snapshot: capacity is
  // computed from the (possibly previous) response, so pair it with the
  // context/cap/GPUs that response echoes back — never live input state, which
  // runs ahead of it during the debounce window.
  const fitConfigSummary = formatFitConfigSummary(
    capacityOpts.maxModelLen,
    capacityOpts.maxNumSeqs,
    estimateGpus,
    effectiveTypicalLen,
  );
  const fitVerdict = formatCapacityVerdict({
    starts: selectedCapacity?.starts,
    partition,
    contextLength: capacityOpts.maxModelLen,
    typicalSeqLen: effectiveTypicalLen,
    concurrentAtFullContext: selectedCapacity?.concurrentAtFullContext,
    concurrentAtTypical: selectedCapacity?.concurrentAtTypical,
    kvPoolTokens: selectedCapacity?.kvPoolTokens,
    pending: fitPending || (isFetchingFit && selectedCapacity?.starts == null),
  });
  const selectedSuBreakdown =
    selectedFit?.su_per_gpu_hour != null && selectedFit.estimated_job_su != null
      ? formatSuBreakdown(
          selectedFit.su_per_gpu_hour,
          estimateGpus,
          estimateDurationHours,
          selectedFit.estimated_job_su,
        )
      : null;
  const canLaunch =
    !isZeroDuration &&
    hours !== '' &&
    minutes !== '' &&
    parsedContext > 0 &&
    parsedNumSeqs > 0 &&
    !definiteNoStart &&
    !fitPending;

  const validationErrorMessage =
    hours === ''
      ? 'Hours cannot be empty.'
      : minutes === ''
        ? 'Minutes cannot be empty.'
        : isZeroDuration
          ? 'Duration must be at least 1 minute.'
          : !(parsedContext > 0)
            ? 'Context length must be positive.'
            : !(parsedNumSeqs > 0)
              ? 'Scheduler cap must be at least 1.'
              : definiteNoStart
                ? 'This context length will not start on the selected partition.'
                : null;

  function handleHoursChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    if (val === '' || (/^\d+$/.test(val) && parseInt(val, 10) <= 23)) {
      setHours(val);
    }
  }

  function handleMinutesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    if (val === '' || (/^\d+$/.test(val) && parseInt(val, 10) <= 59)) {
      setMinutes(val);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canLaunch) return;
    onLaunch({
      time: timeStr,
      partition,
      resource_type: resourceTypeForPartition(partition),
      max_model_len: parsedContext,
      ...(concurrencyTouched ? { max_num_seqs: parsedNumSeqs } : {}),
      num_gpus: parsedGpus,
    });
  }

  function handlePartitionChange(nextPartition: string) {
    if (isLaunchPartition(nextPartition)) {
      setPartition(nextPartition);
    }
  }

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (isLaunching && !nextOpen) return;
    onOpenChange(nextOpen);
  };

  const nvidiaPartitions =
    fitEstimate?.partitions.filter(
      (p) => p.supported && isLaunchPartition(p.partition),
    ) ??
    LAUNCH_PARTITIONS.map((name) => ({
      partition: name,
      gpu_type: name,
      vendor: 'NVIDIA',
      vram_gib: 0,
      supported: true,
      skipped_reason: null,
      fits: null,
      headroom_gib: null,
      su_per_gpu_hour: null,
      effective_su_per_hour: null,
      estimated_job_su: null,
      starts: null,
      kv_pool_gib: null,
      kv_pool_tokens: null,
      concurrent_at_full_context: null,
      concurrent_at_typical: null,
    }));

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="size-5 text-primary" />
            Launch {modelName}
          </DialogTitle>
          <DialogDescription>
            Set how long you need {modelName} to run. We check that your context
            length starts on each partition and estimate how much concurrency it
            can sustain before launch.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-3">
            <Label className="text-sm font-medium">Duration</Label>
            <div className="flex items-end gap-3">
              <div className="flex-1 space-y-1.5">
                <Label
                  htmlFor="launch-hours"
                  className="text-xs text-muted-foreground"
                >
                  Hours
                </Label>
                <Input
                  id="launch-hours"
                  type="number"
                  min={0}
                  max={23}
                  value={hours}
                  onChange={handleHoursChange}
                  className="text-center tabular-nums"
                />
              </div>
              <span className="mb-2.5 text-xl font-semibold text-muted-foreground">
                :
              </span>
              <div className="flex-1 space-y-1.5">
                <Label
                  htmlFor="launch-minutes"
                  className="text-xs text-muted-foreground"
                >
                  Minutes
                </Label>
                <Input
                  id="launch-minutes"
                  type="number"
                  min={0}
                  max={59}
                  value={minutes}
                  onChange={handleMinutesChange}
                  className="text-center tabular-nums"
                />
              </div>
            </div>
          </div>

          {fitSurveyEnabled && (
            <div
              className={cn(
                'rounded-md border px-3 py-2.5 text-xs',
                fitVerdict.tone === 'success' &&
                  'border-emerald-500/30 bg-emerald-500/5',
                fitVerdict.tone === 'error' &&
                  'border-destructive/30 bg-destructive/5',
                fitVerdict.tone === 'warning' &&
                  'border-amber-500/30 bg-amber-500/5',
                fitVerdict.tone === 'pending' && 'bg-muted/30',
              )}
            >
              <div className="flex items-start gap-2">
                {fitVerdict.tone === 'warning' ? (
                  <AlertCircle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                ) : (
                  <FitStatusIcon status={selectedCapacity?.starts ?? null} />
                )}
                <div className="min-w-0 space-y-1">
                  <p
                    className={cn(
                      'font-medium',
                      fitVerdict.tone === 'success' &&
                        'text-emerald-700 dark:text-emerald-400',
                      fitVerdict.tone === 'error' && 'text-destructive',
                      fitVerdict.tone === 'warning' &&
                        'text-amber-600 dark:text-amber-400',
                    )}
                  >
                    {fitVerdict.title}
                    {isFetchingFit && (
                      <Loader2 className="ml-1.5 inline size-3 animate-spin" />
                    )}
                  </p>
                  <p className="text-muted-foreground">{fitConfigSummary}</p>
                  <p className="text-muted-foreground">{fitVerdict.detail}</p>
                  {fitError && (
                    <p className="text-amber-600 dark:text-amber-400">
                      {fitError instanceof Error
                        ? fitError.message
                        : 'Fit estimate failed'}
                    </p>
                  )}
                  {!advancedOpen && selectedSuBreakdown && fitEnabled && (
                    <p className="pt-1 text-muted-foreground">
                      {selectedSuBreakdown}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="flex w-full items-center justify-between"
              >
                <span className="flex items-center gap-2">
                  <Settings2 className="size-4" />
                  Advanced options
                </span>
                <ChevronDown
                  className={cn(
                    'size-4 transition-transform',
                    advancedOpen && 'rotate-180',
                  )}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-4 space-y-4">
              <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5 text-sm font-medium">
                    <Gauge className="size-4 text-primary" />
                    Context &amp; concurrency
                  </Label>
                  {isFetchingFit && (
                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <HardDrive className="size-3.5" />
                      Context length
                    </span>
                    <span className="font-medium tabular-nums">
                      {displayContext.toLocaleString()}
                      <span className="font-normal text-muted-foreground">
                        {' '}
                        / {modelMaxContext.toLocaleString()} tok
                      </span>
                    </span>
                  </div>
                  <TrackSlider
                    label="Context length"
                    min={512}
                    max={modelMaxContext}
                    step={512}
                    value={displayContext}
                    onValueChange={(v) => setContextLength(String(v))}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Max tokens per request (vLLM max-model-len). Startup
                    requires room for one request at this length.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Layers className="size-3.5" />
                      Scheduler cap
                    </span>
                    {overrideOpen ? (
                      <Input
                        aria-label="Scheduler cap override"
                        type="number"
                        min={1}
                        value={numSeqs}
                        onChange={(e) => {
                          setConcurrencyTouched(true);
                          setNumSeqs(e.target.value);
                        }}
                        className="h-7 w-24 text-right tabular-nums"
                      />
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="font-medium tabular-nums">
                          {defaultMaxNumSeqs.toLocaleString()}
                          <span className="font-normal text-muted-foreground">
                            {' '}
                            ·{' '}
                            {defaultMaxNumSeqs === VLLM_DEFAULT_MAX_NUM_SEQS
                              ? 'vLLM default'
                              : 'set by catalog'}
                          </span>
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => setOverrideOpen(true)}
                        >
                          Override
                        </Button>
                      </span>
                    )}
                  </div>
                  {overrideOpen ? (
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[10px] text-muted-foreground">
                        Max requests scheduled at once (vLLM max-num-seqs).
                        Lower caps free ~2 MiB per request for the KV pool;
                        higher caps never speed anything up — memory is the
                        real limit. The sustainable concurrency above is
                        computed from memory, not this cap.
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 shrink-0 px-2 text-[11px]"
                        onClick={() => {
                          setNumSeqs(String(defaultMaxNumSeqs));
                          setConcurrencyTouched(false);
                          setOverrideOpen(false);
                        }}
                      >
                        Use default
                      </Button>
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">
                      Requests beyond the sustainable capacity shown above
                      queue; the cap reserves no memory and rarely needs
                      changing.
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <Cpu className="size-3.5" />
                    GPUs (TP)
                  </Label>
                  <Select value={numGpus} onValueChange={setNumGpus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GPU_COUNT_OPTIONS.map((n) => {
                        const allowed = allowedGpuOptions.includes(n);
                        return (
                          <SelectItem
                            key={n}
                            value={String(n)}
                            disabled={!allowed}
                          >
                            {n} GPU{n > 1 ? 's' : ''}
                            {!allowed
                              ? ` (max ${partitionGpuCap} on ${partition})`
                              : ''}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Partition</Label>
                  <Select
                    value={partition}
                    onValueChange={handlePartitionChange}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LAUNCH_PARTITIONS.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">GPU fit &amp; SU estimate</Label>
                  {isFetchingFit && (
                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Gate certifies startup: the KV pool must hold one full-context
                  sequence. Concurrency is reported as sustainable capacity —
                  vLLM queues requests past it instead of reserving all request
                  memory up front. SU scales with GPU count.
                </p>

                <div className="space-y-1">
                  {nvidiaPartitions.map((p) => {
                    const isCheapest =
                      fitEstimate?.cheapest_feasible_partition === p.partition;
                    const isSelected = p.partition === partition;
                    const rowCapacity = resolvePartitionCapacity(
                      p,
                      capacityOpts,
                    );
                    const rowBreakdown =
                      p.su_per_gpu_hour != null && p.estimated_job_su != null
                        ? formatSuBreakdown(
                            p.su_per_gpu_hour,
                            estimateGpus,
                            estimateDurationHours,
                            p.estimated_job_su,
                          )
                        : null;
                    return (
                      <button
                        key={p.partition}
                        type="button"
                        onClick={() => handlePartitionChange(p.partition)}
                        className={cn(
                          'flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                          isSelected && 'bg-primary/10 ring-1 ring-primary/30',
                          isCheapest && !isSelected && 'bg-emerald-500/5',
                        )}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-2">
                            <FitStatusIcon status={rowCapacity.starts} />
                            <span className="truncate font-medium">
                              {p.partition}
                            </span>
                            {isCheapest && rowCapacity.starts && (
                              <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                                Lowest SU
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-right tabular-nums text-muted-foreground">
                            {p.estimated_job_su != null ? (
                              <>
                                <span className="block text-foreground">
                                  {formatSu(p.estimated_job_su)} SU
                                </span>
                                {p.effective_su_per_hour != null && (
                                  <span className="block text-[10px]">
                                    {formatSu(p.effective_su_per_hour)} SU/hr
                                  </span>
                                )}
                              </>
                            ) : rowCapacity.starts === false ? (
                              "Won't start"
                            ) : (
                              '—'
                            )}
                          </span>
                        </span>
                        {rowBreakdown && (
                          <span className="pl-6 text-[10px] text-muted-foreground">
                            {rowBreakdown}
                            {rowCapacity.starts === true &&
                              rowCapacity.concurrentAtFullContext != null && (
                                <>
                                  {' · '}~{rowCapacity.concurrentAtFullContext}{' '}
                                  concurrent @ full ctx
                                </>
                              )}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {selectedCapacity?.starts === false && (
                  <p className="text-xs text-destructive">
                    {partition} can&apos;t start at context{' '}
                    {capacityOpts.maxModelLen.toLocaleString()}: the KV pool
                    can&apos;t hold one full-length sequence. Lower the context
                    or add GPUs.
                  </p>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {validationErrorMessage && (
            <p className="text-xs text-destructive">{validationErrorMessage}</p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLaunching}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canLaunch || isLaunching}>
              {isLaunching ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Launching...
                </>
              ) : (
                'Launch'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
