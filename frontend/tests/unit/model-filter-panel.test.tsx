// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ModelFilterPanel } from '@/components/model-library-filters';
import { EMPTY_MODEL_FILTERS, type ModelFilters } from '@/lib/models/filters';

// Radix's slider measures itself; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const typeOptions = ['LLM', 'VLM', 'Text_Embedding', 'Reward_Modeling'];

function renderPanel(filters: ModelFilters = EMPTY_MODEL_FILTERS) {
  const onChange = vi.fn();
  render(
    <ModelFilterPanel
      filters={filters}
      onChange={onChange}
      typeOptions={typeOptions}
      gpuSteps={[1, 2, 4, 8]}
    />,
  );
  return onChange;
}

afterEach(cleanup);

describe('ModelFilterPanel', () => {
  it('unticking a type hides it', () => {
    const onChange = renderPanel();
    fireEvent.click(screen.getByLabelText('Embedding'));
    expect(onChange).toHaveBeenCalledWith({
      hiddenTypes: ['Text_Embedding'],
      gpuRange: null,
    });
  });

  it('"Chat models only" hides the non-chat types', () => {
    const onChange = renderPanel();
    fireEvent.click(screen.getByLabelText('Chat models only'));
    expect(onChange).toHaveBeenCalledWith({
      hiddenTypes: ['Text_Embedding', 'Reward_Modeling'],
      gpuRange: null,
    });
  });

  it('shows the selected GPU range and resets every filter', () => {
    const onChange = renderPanel({ hiddenTypes: ['VLM'], gpuRange: [2, 4] });
    expect(screen.getByText('2 – 4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(onChange).toHaveBeenCalledWith(EMPTY_MODEL_FILTERS);
  });

  it('moving the slider snaps to real GPU counts', () => {
    const onChange = renderPanel();
    const maxThumb = screen.getByRole('slider', { name: 'Maximum GPUs' });
    maxThumb.focus();
    fireEvent.keyDown(maxThumb, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith({ hiddenTypes: [], gpuRange: [1, 4] });
  });
});
