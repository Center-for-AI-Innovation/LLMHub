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
  const [typicalLen, setTypicalLen] = React.useState(
    String(DEFAULT_TYPICAL_SEQ_LEN),
  );
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setPartition(defaultPartition);
      setContextLength(String(defaultContextLength));
      setNumGpus(String(clampGpuCount(defaultGpus, defaultPartition)));
      setNumSeqs(String(defaultMaxNumSeqs));
      setConcurrencyTouched(false);
      setTypicalLen(String(DEFAULT_TYPICAL_SEQ_LEN));
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
  const parsedTypicalLen = parseInt(typicalLen || '0', 10);

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

  const debouncedFitKey = useDebounce(
    open
      ? {
          model_id: hfModelId,
          model_family: modelFamily,
          huggingface_id: huggingfaceId,
          max_model_len: parsedContext,
          max_num_seqs: effectiveConcurrency,
          typical_seq_len: parsedTypicalLen > 0 ? parsedTypicalLen : undefined,
          tensor_parallel_size: parsedGpus,
          time: timeStr,
        }
      : null,
    400,
  );

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
    fitEstimate?.typical_seq_len ??
    (parsedTypicalLen > 0 ? parsedTypicalLen : DEFAULT_TYPICAL_SEQ_LEN);
  const capacityOpts = {
    perTokenKvBytes: fitEstimate?.per_token_kv_bytes,
    maxModelLen: fitEstimate?.max_model_len ?? parsedContext,
    typicalSeqLen: effectiveTypicalLen,
    maxNumSeqs: fitEstimate?.max_num_seqs ?? effectiveConcurrency,
  };
  const selectedCapacity = selectedFit
    ? resolvePartitionCapacity(selectedFit, capacityOpts)
    : null;
  const selectedStarts = selectedCapacity?.starts === true;

  // Context determines whether vLLM can start. max_num_seqs is a scheduler cap:
  // requests above the resident KV capacity queue, so it must not artificially
  // shorten the selectable context range.
  const MIN_CONTEXT = 512;
  const modelMaxContext = Math.max(MIN_CONTEXT, defaultContextLength);
  const concurrencySliderMax = Math.max(512, defaultMaxNumSeqs, parsedNumSeqs);
  const displayContext = Math.min(
    Math.max(parsedContext || MIN_CONTEXT, MIN_CONTEXT),
    modelMaxContext,
  );
  const displayConcurrency = Math.min(
    Math.max(parsedNumSeqs || 1, 1),
    concurrencySliderMax,
  );

  const fitConfigSummary = formatFitConfigSummary(
    parsedContext,
    effectiveConcurrency,
    parsedGpus,
    effectiveTypicalLen,
  );
  const fitVerdict = formatCapacityVerdict({
    starts: selectedCapacity?.starts,
    partition,
    contextLength: parsedContext,
    typicalSeqLen: effectiveTypicalLen,
    concurrentAtFullContext: selectedCapacity?.concurrentAtFullContext,
    concurrentAtTypical: selectedCapacity?.concurrentAtTypical,
    kvPoolTokens: selectedCapacity?.kvPoolTokens,
  });
  const selectedSuBreakdown =
    selectedFit?.su_per_gpu_hour != null && selectedFit.estimated_job_su != null
      ? formatSuBreakdown(
          selectedFit.su_per_gpu_hour,
          parsedGpus,
          durationHours,
          selectedFit.estimated_job_su,
        )
      : null;
  const canLaunch =
    !isZeroDuration &&
    hours !== '' &&
    minutes !== '' &&
    parsedContext > 0 &&
    parsedNumSeqs > 0 &&
    selectedStarts;

  const validationErrorMessage =
    hours === ''
      ? 'Hours cannot be empty.'
      : minutes === ''
        ? 'Minutes cannot be empty.'
        : isZeroDuration
          ? 'Duration must be at least 1 minute.'
          : parsedContext <= 0
            ? 'Context length must be positive.'
            : parsedNumSeqs <= 0
              ? 'Concurrency must be at least 1.'
              : selectedCapacity?.starts === false
                ? 'This context length will not start on the selected partition.'
                : selectedCapacity?.starts == null &&
                    fitEstimate &&
                    !isFetchingFit
                  ? fitEstimate.warnings.length > 0
                    ? fitEstimate.warnings.join(' ')
                    : 'Startup could not be verified — model weight or KV metadata is missing.'
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
                fitVerdict.tone === 'pending' && 'bg-muted/30',
              )}
            >
              <div className="flex items-start gap-2">
                <FitStatusIcon status={selectedCapacity?.starts ?? null} />
                <div className="min-w-0 space-y-1">
                  <p
                    className={cn(
                      'font-medium',
                      fitVerdict.tone === 'success' &&
                        'text-emerald-700 dark:text-emerald-400',
                      fitVerdict.tone === 'error' && 'text-destructive',
                    )}
                  >
                    {fitVerdict.title}
                    {isFetchingFit && (
                      <Loader2 className="ml-1.5 inline size-3 animate-spin" />
                    )}
                  </p>
                  <p className="text-muted-foreground">{fitConfigSummary}</p>
                  <p className="text-muted-foreground">{fitVerdict.detail}</p>
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
                      Concurrency
                    </span>
                    <span className="font-medium tabular-nums">
                      {displayConcurrency.toLocaleString()}
                      <span className="font-normal text-muted-foreground">
                        {' '}
                        / {concurrencySliderMax.toLocaleString()} max
                      </span>
                    </span>
                  </div>
                  <TrackSlider
                    label="Concurrency cap"
                    min={1}
                    max={concurrencySliderMax}
                    step={1}
                    value={displayConcurrency}
                    onValueChange={(v) => {
                      setConcurrencyTouched(true);
                      setNumSeqs(String(v));
                    }}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Scheduler limit (vLLM max-num-seqs). Requests beyond the
                    sustainable capacity shown above queue instead of reserving
                    more KV memory at startup.
                  </p>
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

                {fitError && (
                  <p className="text-xs text-destructive">
                    {fitError instanceof Error
                      ? fitError.message
                      : 'Fit estimate failed'}
                  </p>
                )}

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
                            parsedGpus,
                            durationHours,
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
                    {parsedContext.toLocaleString()}: the KV pool can&apos;t
                    hold one full-length sequence. Lower the context or add
                    GPUs.
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
