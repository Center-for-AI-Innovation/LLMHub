'use client';

import * as React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Cpu,
  HardDrive,
  Layers,
  Loader2,
  Settings2,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/use-debounce';
import { useFitEstimate } from '@/hooks/use-fit-estimate';
import { resolveHfModelId } from '@/lib/models/huggingface';
import {
  allowedGpuOptionsForPartition,
  clampGpuCount,
  durationHoursFromParts,
  formatDuration,
  formatFitConfigSummary,
  formatFitVerdict,
  formatSu,
  formatSuBreakdown,
  GPU_COUNT_OPTIONS,
  LAUNCH_PARTITIONS,
  maxGpusForPartition,
  resourceTypeForPartition,
  VLLM_DEFAULT_MAX_NUM_SEQS,
} from '@/lib/models/launch-config';

export interface LaunchConfig {
  time: string;
  partition: string;
  resource_type: string;
  max_model_len: number;
  /** Set only when the user explicitly changed concurrency. */
  max_num_seqs?: number;
  num_gpus: number;
}

interface LaunchModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelName: string;
  modelId: string;
  huggingfaceId?: string;
  defaultContextLength?: number;
  defaultGpus?: number;
  defaultPartition?: string;
  defaultMaxNumSeqs?: number;
  modelFamily?: string;
  isLaunching: boolean;
  onLaunch: (config: LaunchConfig) => void;
}

function FitStatusIcon({ fits }: { fits: boolean | null }) {
  if (fits === true) {
    return <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />;
  }
  if (fits === false) {
    return <XCircle className="size-4 shrink-0 text-destructive" />;
  }
  return <AlertCircle className="size-4 shrink-0 text-muted-foreground" />;
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
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setPartition(defaultPartition);
      setContextLength(String(defaultContextLength));
      setNumGpus(
        String(clampGpuCount(defaultGpus, defaultPartition)),
      );
      setNumSeqs(String(defaultMaxNumSeqs));
      setConcurrencyTouched(false);
    }
  }, [open, defaultPartition, defaultContextLength, defaultGpus, defaultMaxNumSeqs]);

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

  const debouncedFitKey = useDebounce(
    open
      ? {
          model_id: hfModelId,
          model_family: modelFamily,
          huggingface_id: huggingfaceId,
          max_model_len: parsedContext,
          max_num_seqs: effectiveConcurrency,
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

  const selectedFit = fitEstimate?.partitions.find((p) => p.partition === partition);
  const selectedFits = selectedFit?.fits === true;
  const fitConfigSummary = formatFitConfigSummary(
    parsedContext,
    effectiveConcurrency,
    parsedGpus,
  );
  const fitVerdict = formatFitVerdict(
    selectedFit?.fits,
    partition,
    selectedFit?.headroom_gib,
  );
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
    selectedFits;

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
              : selectedFit?.fits === false
                ? 'Selected partition cannot fit this context length and concurrency.'
                : selectedFit?.fits == null && fitEstimate && !isFetchingFit
                  ? 'Fit could not be verified for this model — check metadata or try again.'
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

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (isLaunching && !nextOpen) return;
    onOpenChange(nextOpen);
  };

  const nvidiaPartitions =
    fitEstimate?.partitions.filter((p) => p.supported) ??
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
            Set how long you need {modelName} to run. We check whether your
            context length and concurrency fit on each partition before launch.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-3">
            <Label className="text-sm font-medium">Duration</Label>
            <div className="flex items-end gap-3">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="launch-hours" className="text-xs text-muted-foreground">
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
              <span className="mb-2.5 text-xl font-semibold text-muted-foreground">:</span>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="launch-minutes" className="text-xs text-muted-foreground">
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
                <FitStatusIcon fits={selectedFit?.fits ?? null} />
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
                    <p className="pt-1 text-muted-foreground">{selectedSuBreakdown}</p>
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
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="launch-context" className="flex items-center gap-1.5">
                    <HardDrive className="size-3.5" />
                    Context length
                  </Label>
                  <Input
                    id="launch-context"
                    type="number"
                    min={512}
                    step={512}
                    value={contextLength}
                    onChange={(e) => setContextLength(e.target.value)}
                    className="tabular-nums"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Max tokens per sequence (max-model-len).
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="launch-concurrency" className="flex items-center gap-1.5">
                    <Layers className="size-3.5" />
                    Concurrency
                  </Label>
                  <Input
                    id="launch-concurrency"
                    type="number"
                    min={1}
                    step={1}
                    value={numSeqs}
                    onChange={(e) => {
                      setConcurrencyTouched(true);
                      setNumSeqs(e.target.value);
                    }}
                    className="tabular-nums"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Effective default {defaultMaxNumSeqs.toLocaleString()} from
                    catalog (vLLM {VLLM_DEFAULT_MAX_NUM_SEQS} when unset).
                    Change only if you need a different cap. Typical workload
                    factors are advisory only.
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
                  <Select value={partition} onValueChange={setPartition}>
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
                  Fit certifies worst-case KV = context × effective concurrency
                  (catalog or your override). SU scales with GPU count.
                </p>

                {fitError && (
                  <p className="text-xs text-destructive">
                    {fitError instanceof Error ? fitError.message : 'Fit estimate failed'}
                  </p>
                )}

                <div className="space-y-1">
                  {nvidiaPartitions.map((p) => {
                    const isCheapest =
                      fitEstimate?.cheapest_feasible_partition === p.partition;
                    const isSelected = p.partition === partition;
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
                        onClick={() => setPartition(p.partition)}
                        className={cn(
                          'flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                          isSelected && 'bg-primary/10 ring-1 ring-primary/30',
                          isCheapest && !isSelected && 'bg-emerald-500/5',
                        )}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-2">
                            <FitStatusIcon fits={p.fits} />
                            <span className="truncate font-medium">{p.partition}</span>
                            {isCheapest && p.fits && (
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
                            ) : p.fits === false ? (
                              'No fit'
                            ) : (
                              '—'
                            )}
                          </span>
                        </span>
                        {rowBreakdown && (
                          <span className="pl-6 text-[10px] text-muted-foreground">
                            {rowBreakdown}
                            {p.fits === true && p.headroom_gib != null && (
                              <>
                                {' · '}
                                {p.headroom_gib.toFixed(1)} GiB headroom/GPU
                              </>
                            )}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {selectedFit && selectedFit.fits === false && (
                  <p className="text-xs text-destructive">
                    {partition} cannot fit context {parsedContext.toLocaleString()}{' '}
                    with concurrency {parsedNumSeqs.toLocaleString()}.
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
