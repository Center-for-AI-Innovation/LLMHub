import { describe, expect, it } from 'vitest';

import {
  activeFilterCount,
  chatOnlyHiddenTypes,
  EMPTY_MODEL_FILTERS,
  filterModels,
  gpuCountSteps,
  modelGpuCount,
  modelTypeLabel,
  modelTypeOptions,
} from '@/lib/models/filters';
import type { ModelInfo } from '@/lib/models/types';

function model(id: string, modelType: string | undefined, gpus: number, nodes = 1): ModelInfo {
  return {
    id,
    name: id,
    description: '',
    status: 'cold',
    size: 'Small',
    family: '',
    variant: '',
    modelType,
    specs: { gpus, nodes, contextLength: 0, parallelism: false },
  };
}

const catalog = [
  model('llm-1', 'LLM', 1),
  model('llm-8', 'LLM', 4, 2),
  model('vlm-2', 'VLM', 2),
  model('embed', 'Text_Embedding', 1),
  model('reward', 'Reward_Modeling', 4),
  model('untyped', undefined, 1),
];

const ids = (models: ModelInfo[]) => models.map((m) => m.id);

describe('model filters', () => {
  it('shows everything with no filters', () => {
    expect(ids(filterModels(catalog, EMPTY_MODEL_FILTERS))).toEqual(ids(catalog));
    expect(activeFilterCount(EMPTY_MODEL_FILTERS)).toBe(0);
  });

  it('hides unticked types, treating a missing type as LLM', () => {
    const shown = filterModels(catalog, { hiddenTypes: ['LLM'], gpuRange: null });
    expect(ids(shown)).toEqual(['vlm-2', 'embed', 'reward']);
  });

  it('chat-only hides every type except LLM and VLM', () => {
    const hiddenTypes = chatOnlyHiddenTypes(modelTypeOptions(catalog));
    expect(hiddenTypes).toEqual(['Text_Embedding', 'Reward_Modeling']);
    expect(ids(filterModels(catalog, { hiddenTypes, gpuRange: null }))).toEqual([
      'llm-1',
      'llm-8',
      'vlm-2',
      'untyped',
    ]);
  });

  it('counts GPUs across nodes and filters by an inclusive range', () => {
    expect(modelGpuCount(catalog[1])).toBe(8);
    expect(gpuCountSteps(catalog)).toEqual([1, 2, 4, 8]);
    const shown = filterModels(catalog, { hiddenTypes: [], gpuRange: [2, 4] });
    expect(ids(shown)).toEqual(['vlm-2', 'reward']);
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
