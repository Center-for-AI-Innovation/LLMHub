import { describe, expect, it } from 'vitest';

import {
  activeFilterCount,
  contextLengthSteps,
  EMPTY_MODEL_FILTERS,
  filterModels,
  gpuCountSteps,
  modelGpuCount,
  modelTypeLabel,
  modelTypeOptions,
} from '@/lib/models/filters';
import type { ModelInfo } from '@/lib/models/types';

function model(
  id: string,
  modelType: string | undefined,
  gpus: number,
  nodes = 1,
  extra: { gated?: string; contextLength?: number } = {},
): ModelInfo & { gated?: string } {
  return {
    id,
    name: id,
    description: '',
    status: 'cold',
    size: 'Small',
    family: '',
    variant: '',
    modelType,
    gated: extra.gated,
    specs: { gpus, nodes, contextLength: extra.contextLength ?? 0, parallelism: false },
  };
}

const catalog = [
  model('llm-1', 'LLM', 1, 1, { contextLength: 4096 }),
  model('llm-8', 'LLM', 4, 2, { gated: 'manual', contextLength: 131072 }),
  model('vlm-2', 'VLM', 2, 1, { gated: 'unknown', contextLength: 32768 }),
  model('embed', 'Text_Embedding', 1),
  model('reward', 'Reward_Modeling', 4),
  model('untyped', undefined, 1),
];

const ids = (models: { id: string }[]) => models.map((m) => m.id);

describe('model filters', () => {
  it('shows everything with no filters', () => {
    expect(ids(filterModels(catalog, EMPTY_MODEL_FILTERS))).toEqual(ids(catalog));
    expect(activeFilterCount(EMPTY_MODEL_FILTERS)).toBe(0);
  });

  it('hides unticked types, treating a missing type as LLM', () => {
    const shown = filterModels(catalog, { ...EMPTY_MODEL_FILTERS, hiddenTypes: ['LLM'] });
    expect(ids(shown)).toEqual(['vlm-2', 'embed', 'reward']);
  });

  it('counts GPUs across nodes and filters by an inclusive range', () => {
    expect(modelGpuCount(catalog[1])).toBe(8);
    expect(gpuCountSteps(catalog)).toEqual([1, 2, 4, 8]);
    const shown = filterModels(catalog, { ...EMPTY_MODEL_FILTERS, gpuRange: [2, 4] });
    expect(ids(shown)).toEqual(['vlm-2', 'reward']);
  });

  it('hides gated models, counting an unconfirmed status as gated', () => {
    const shown = filterModels(catalog, { ...EMPTY_MODEL_FILTERS, hideGated: true });
    expect(ids(shown)).toEqual(['llm-1', 'embed', 'reward', 'untyped']);
  });

  it('keeps models with at least the minimum context, dropping unknown lengths', () => {
    expect(contextLengthSteps(catalog)).toEqual([4096, 32768, 131072]);
    const shown = filterModels(catalog, { ...EMPTY_MODEL_FILTERS, minContext: 32768 });
    expect(ids(shown)).toEqual(['llm-8', 'vlm-2']);
    expect(activeFilterCount({ ...EMPTY_MODEL_FILTERS, minContext: 32768, hideGated: true })).toBe(2);
  });

  it('lists known types first with readable labels, and new types after', () => {
    const options = modelTypeOptions([...catalog, model('x', 'Speech_To_Text', 1)]);
    expect(options).toEqual([
      'LLM',
      'VLM',
      'Text_Embedding',
      'Reward_Modeling',
      'Speech_To_Text',
    ]);
    expect(options.map(modelTypeLabel)).toEqual([
      'LLM',
      'VLM',
      'Embedding',
      'Reward',
      'Speech To Text',
    ]);
  });
});
