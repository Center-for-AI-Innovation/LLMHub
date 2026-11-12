import { describe, expect, it } from 'vitest';

import { formatModelType } from '@/components/model-card/model-metadata-chips';

describe('formatModelType', () => {
  it('defaults a missing type to LLM, matching the backend', () => {
    expect(formatModelType(null)).toBe('LLM');
    expect(formatModelType(undefined)).toBe('LLM');
    expect(formatModelType('')).toBe('LLM');
  });

  it('replaces underscores with spaces', () => {
    expect(formatModelType('vision_language')).toBe('vision language');
  });

  it('leaves other types unchanged', () => {
    expect(formatModelType('LLM')).toBe('LLM');
    expect(formatModelType('embedding')).toBe('embedding');
  });
});
