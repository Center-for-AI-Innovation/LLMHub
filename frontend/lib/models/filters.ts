import type { ModelInfo } from '@/lib/models/types';

type FilterableModel = Pick<ModelInfo, 'modelType' | 'specs'> & {
  gated?: string | null;
};

export interface ModelFilters {
  // Types to hide, so a type added to the catalog later is shown by default.
  hiddenTypes: string[];
  // Inclusive total-GPU bounds; null means no limit.
  gpuRange: [number, number] | null;
  hideGated: boolean;
  // Minimum context length in tokens; null means no limit.
  minContext: number | null;
}

export const EMPTY_MODEL_FILTERS: ModelFilters = {
  hiddenTypes: [],
  gpuRange: null,
  hideGated: false,
  minContext: null,
};

const TYPE_LABELS: Record<string, string> = {
  LLM: 'LLM',
  VLM: 'VLM',
  Text_Embedding: 'Embedding',
  Reward_Modeling: 'Reward',
};

// The backend defaults a missing model_type to "LLM".
export function modelTypeOf(model: Pick<ModelInfo, 'modelType'>): string {
  return model.modelType || 'LLM';
}

export function modelTypeLabel(modelType: string): string {
  return TYPE_LABELS[modelType] ?? modelType.replace(/_/g, ' ');
}

export function modelGpuCount(model: Pick<ModelInfo, 'specs'>): number {
  return (model.specs?.gpus || 1) * (model.specs?.nodes || 1);
}

/** Types present in ``models``, in a fixed order with known types first. */
export function modelTypeOptions(models: FilterableModel[]): string[] {
  const present = new Set(models.map(modelTypeOf));
  const known = Object.keys(TYPE_LABELS).filter((type) => present.has(type));
  const other = [...present].filter((type) => !(type in TYPE_LABELS)).sort();
  return [...known, ...other];
}

/** Distinct total GPU counts in ``models``, ascending: the slider's stops. */
export function gpuCountSteps(models: FilterableModel[]): number[] {
  return [...new Set(models.map(modelGpuCount))].sort((a, b) => a - b);
}

/** Distinct known context lengths in ``models``, ascending: the slider's stops. */
export function contextLengthSteps(models: FilterableModel[]): number[] {
  const lengths = models
    .map((model) => model.specs?.contextLength || 0)
    .filter((length) => length > 0);
  return [...new Set(lengths)].sort((a, b) => a - b);
}

export function activeFilterCount(filters: ModelFilters): number {
  return [
    filters.hiddenTypes.length > 0,
    filters.gpuRange !== null,
    filters.hideGated,
    filters.minContext !== null,
  ].filter(Boolean).length;
}

export function filterModels<T extends FilterableModel>(models: T[], filters: ModelFilters): T[] {
  const hidden = new Set(filters.hiddenTypes);
  return models.filter((model) => {
    if (hidden.has(modelTypeOf(model))) return false;
    if (filters.gpuRange) {
      const gpus = modelGpuCount(model);
      if (gpus < filters.gpuRange[0] || gpus > filters.gpuRange[1]) return false;
    }
    // Same rule as the Gated chip: "unknown" (check failed) counts as gated.
    if (filters.hideGated && model.gated) return false;
    // A model with no known context length can't promise the minimum.
    if (filters.minContext !== null && (model.specs?.contextLength || 0) < filters.minContext) {
      return false;
    }
    return true;
  });
}
