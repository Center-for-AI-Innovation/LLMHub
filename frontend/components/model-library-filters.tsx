'use client';

import { SlidersHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { formatContextTokens } from '@/components/model-card/model-metadata-chips';
import {
  activeFilterCount,
  EMPTY_MODEL_FILTERS,
  modelTypeLabel,
  type ModelFilters,
} from '@/lib/models/filters';
import { isChatModelType } from '@/lib/models/types';

interface FilterPanelProps {
  filters: ModelFilters;
  onChange: (filters: ModelFilters) => void;
  typeOptions: string[];
  gpuSteps: number[];
  contextSteps: number[];
}

export function ModelFilterPanel({
  filters,
  onChange,
  typeOptions,
  gpuSteps,
  contextSteps,
}: FilterPanelProps) {
  const hidden = new Set(filters.hiddenTypes);

  function toggleType(type: string, shown: boolean) {
    const next = new Set(hidden);
    if (shown) next.delete(type);
    else next.add(type);
    onChange({ ...filters, hiddenTypes: typeOptions.filter((t) => next.has(t)) });
  }

  // The slider moves over positions in gpuSteps, so it snaps to real GPU counts.
  const last = gpuSteps.length - 1;
  const range = filters.gpuRange ?? [gpuSteps[0], gpuSteps[last]];
  const sliderValue = [
    Math.max(0, gpuSteps.indexOf(range[0])),
    gpuSteps.indexOf(range[1]) === -1 ? last : gpuSteps.indexOf(range[1]),
  ];

  function changeGpuRange([low, high]: number[]) {
    onChange({
      ...filters,
      gpuRange: low === 0 && high === last ? null : [gpuSteps[low], gpuSteps[high]],
    });
  }

  // The first stop is the smallest context in the catalog, i.e. no limit.
  const contextIndex = Math.max(
    0,
    filters.minContext === null ? 0 : contextSteps.indexOf(filters.minContext),
  );

  function changeMinContext([index]: number[]) {
    onChange({ ...filters, minContext: index === 0 ? null : contextSteps[index] });
  }

  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Model type</legend>
        {typeOptions.map((type) => (
          <div key={type} className="flex items-center gap-2">
            <Checkbox
              id={`model-type-${type}`}
              checked={!hidden.has(type)}
              onCheckedChange={(checked) => toggleType(type, checked === true)}
            />
            <Label htmlFor={`model-type-${type}`}>{modelTypeLabel(type)}</Label>
            {isChatModelType(type) && (
              <span className="text-xs text-muted-foreground">· chat</span>
            )}
          </div>
        ))}
      </fieldset>

      <div className="flex items-center gap-2">
        <Checkbox
          id="model-hide-gated"
          checked={filters.hideGated}
          onCheckedChange={(checked) =>
            onChange({ ...filters, hideGated: checked === true })
          }
        />
        <Label htmlFor="model-hide-gated">Hide gated models</Label>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">GPUs</span>
          <span className="text-muted-foreground" aria-live="polite">
            {range[0] === range[1] ? range[0] : `${range[0]} – ${range[1]}`}
          </span>
        </div>
        {last > 0 ? (
          <Slider
            min={0}
            max={last}
            step={1}
            minStepsBetweenThumbs={0}
            value={sliderValue}
            onValueChange={changeGpuRange}
            thumbLabels={['Minimum GPUs', 'Maximum GPUs']}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            All models use the same number of GPUs.
          </p>
        )}
      </div>

      {contextSteps.length > 1 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Context</span>
            <span className="text-muted-foreground" aria-live="polite">
              {filters.minContext === null
                ? 'Any'
                : `${formatContextTokens(filters.minContext)} or more`}
            </span>
          </div>
          <Slider
            min={0}
            max={contextSteps.length - 1}
            step={1}
            value={[contextIndex]}
            onValueChange={changeMinContext}
            thumbLabels={['Minimum context']}
          />
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        disabled={activeFilterCount(filters) === 0}
        onClick={() => onChange(EMPTY_MODEL_FILTERS)}
      >
        Reset filters
      </Button>
    </div>
  );
}

export function ModelLibraryFilters(props: FilterPanelProps) {
  const count = activeFilterCount(props.filters);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <SlidersHorizontal className="size-4" />
          Filters
          {count > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <ModelFilterPanel {...props} />
      </PopoverContent>
    </Popover>
  );
}
