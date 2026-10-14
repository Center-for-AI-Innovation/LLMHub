import { describe, expect, it } from 'vitest';

import { gatedChipInfo } from '@/components/model-card/model-metadata-chips';

describe('gatedChipInfo', () => {
  it('shows nothing for public models', () => {
    expect(gatedChipInfo(null)).toBeNull();
    expect(gatedChipInfo(undefined)).toBeNull();
    expect(gatedChipInfo('')).toBeNull();
  });

  it('labels auto- and manually-gated models as Gated', () => {
    for (const status of ['auto', 'manual']) {
      const info = gatedChipInfo(status);
      expect(info?.label).toBe('Gated');
      expect(info?.description).toContain('your own Hugging Face token');
    }
  });

  it('labels an unconfirmed status as Gated, and says so', () => {
    const info = gatedChipInfo('unknown');
    expect(info?.label).toBe('Gated');
    expect(info?.description).toContain("couldn't be confirmed");
  });
});
