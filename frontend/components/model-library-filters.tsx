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
import {
  activeFilterCount,
  chatOnlyHiddenTypes,
  EMPTY_MODEL_FILTERS,
  modelTypeLabel,
  type ModelFilters,
} from '@/lib/models/filters';

interface FilterPanelProps {
  filters: ModelFilters;
  onChange: (filters: ModelFilters) => void;
  typeOptions: string[];
  gpuSteps: number[];
}

export function ModelFilterPanel({
  filters,
  onChange,
  typeOptions,
  gpuSteps,
}: FilterPanelProps) {
  const hidden = new Set(filters.hiddenTypes);
  const chatOnlyTypes = chatOnlyHiddenTypes(typeOptions);
  const chatOnly =
    chatOnlyTypes.length > 0 &&
    filters.hiddenTypes.length === chatOnlyTypes.length &&
    chatOnlyTypes.every((type) => hidden.has(type));

  function toggleType(type: string, shown: boolean) {
    const next = new Set(hidden);
    if (shown) next.delete(type);
    else next.add(type);
    onChange({ ...filters, hiddenTypes: typeOptions.filter((t) => next.has(t)) });
  }

  function toggleChatOnly(checked: boolean) {
    onChange({ ...filters, hiddenTypes: checked ? chatOnlyTypes : [] });
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
          </div>
        ))}
        {chatOnlyTypes.length > 0 && (
          <div className="flex items-center gap-2 border-t pt-2">
            <Checkbox
              id="model-type-chat-only"
              checked={chatOnly}
              onCheckedChange={(checked) => toggleChatOnly(checked === true)}
            />
            <Label htmlFor="model-type-chat-only">Chat models only</Label>
          </div>
        )}
      </fieldset>

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
