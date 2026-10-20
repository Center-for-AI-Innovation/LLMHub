import { describe, expect, it } from 'vitest';

import type { ModelInfo } from '@/hooks/use-models';
import {
  COUNTRY_OF_CONCERN_LINK,
  COUNTRY_OF_CONCERN_PARAGRAPHS,
  isCountryOfConcernModel,
} from '@/components/model-card/country-of-concern-notice';

function buildModel(overrides: Partial<ModelInfo>): ModelInfo {
  return {
    id: 'gpt-5',
    modelName: 'GPT 5',
    description: '',
    status: 'cold',
    type: 'Large',
    family: 'gpt',
    variant: '',
    specs: { gpus: 1, nodes: 1, contextLength: 8000, parallelism: false },
    ...overrides,
  };
}

describe('isCountryOfConcernModel', () => {
  it('flags DeepSeek models by id, family, or Hugging Face id', () => {
    expect(
      isCountryOfConcernModel(
        buildModel({
          id: 'DeepSeek-R1-Distill-Llama-70B',
          family: 'DeepSeek-AI',
          huggingfaceId: 'deepseek-ai/DeepSeek-R1-Distill-Llama-70B',
        }),
      ),
    ).toBe(true);
    expect(
      isCountryOfConcernModel(
        buildModel({
          id: 'deepseek-vl2-small',
          family: 'deepseek-vl2',
          huggingfaceId: 'deepseek-ai/deepseek-vl2-small',
        }),
      ),
    ).toBe(true);
  });

  it('does not flag other models', () => {
    expect(
      isCountryOfConcernModel(
        buildModel({ id: 'Llama-3.3-70B', family: 'llama' }),
      ),
    ).toBe(false);
    expect(
      isCountryOfConcernModel(
        buildModel({ id: 'claude-sonnet-4-5', family: 'claude' }),
      ),
    ).toBe(false);
  });

  it('carries the Country of Concern and removal-directive wording', () => {
    const notice = COUNTRY_OF_CONCERN_PARAGRAPHS.join(' ');
    expect(notice).toContain('Country of Concern');
    expect(notice).toContain('October 19, 2026');
    expect(notice).toContain('remove DeepSeek');
    expect(notice).toContain('We are not yet removing DeepSeek');
  });

  it('links the Country of Concern phrase to the UI System guidance PDF', () => {
    expect(COUNTRY_OF_CONCERN_PARAGRAPHS[0]).toContain('Country of Concern');
    expect(COUNTRY_OF_CONCERN_LINK).toBe(
      'https://ai.uillinois.edu/userfiles/public/ui_system_ai_guidance_countries_of_concern.pdf',
    );
  });
});
