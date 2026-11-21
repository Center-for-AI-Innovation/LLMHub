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
      contextSteps={[4096, 32768, 131072]}
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
      ...EMPTY_MODEL_FILTERS,
      hiddenTypes: ['Text_Embedding'],
    });
  });

  it('each checkbox changes only its own type', () => {
    const onChange = renderPanel({ ...EMPTY_MODEL_FILTERS, hiddenTypes: ['Text_Embedding'] });
    fireEvent.click(screen.getByLabelText('VLM'));
    expect(onChange).toHaveBeenCalledWith({
      ...EMPTY_MODEL_FILTERS,
      hiddenTypes: ['VLM', 'Text_Embedding'],
    });
  });

  it('marks only LLM and VLM as chat', () => {
    renderPanel();
    expect(screen.getAllByText('· chat')).toHaveLength(2);
  });

  it('shows the selected GPU range and resets every filter', () => {
    const onChange = renderPanel({ ...EMPTY_MODEL_FILTERS, hiddenTypes: ['VLM'], gpuRange: [2, 4] });
    expect(screen.getByText('2 – 4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(onChange).toHaveBeenCalledWith(EMPTY_MODEL_FILTERS);
  });

  it('moving the slider snaps to real GPU counts', () => {
    const onChange = renderPanel();
    const maxThumb = screen.getByRole('slider', { name: 'Maximum GPUs' });
    maxThumb.focus();
    fireEvent.keyDown(maxThumb, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_MODEL_FILTERS, gpuRange: [1, 4] });
  });

  it('"Hide gated models" turns on the gated filter', () => {
    const onChange = renderPanel();
    fireEvent.click(screen.getByLabelText('Hide gated models'));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_MODEL_FILTERS, hideGated: true });
  });

  it('the context slider sets a minimum from the catalog\'s lengths', () => {
    const onChange = renderPanel();
    expect(screen.getByText('Any')).toBeTruthy();
    const thumb = screen.getByRole('slider', { name: 'Minimum context' });
    thumb.focus();
    fireEvent.keyDown(thumb, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_MODEL_FILTERS, minContext: 32768 });
  });

  it('keeps hidden types that are not among the current options', () => {
    const onChange = renderPanel({ ...EMPTY_MODEL_FILTERS, hiddenTypes: ['Speech'] });
    fireEvent.click(screen.getByLabelText('VLM'));
    expect(onChange).toHaveBeenCalledWith({
      ...EMPTY_MODEL_FILTERS,
      hiddenTypes: ['VLM', 'Speech'],
    });
  });

  it('screen readers hear real GPU counts and context lengths', () => {
    renderPanel({ ...EMPTY_MODEL_FILTERS, gpuRange: [2, 8], minContext: 32768 });
    const maxGpus = screen.getByRole('slider', { name: 'Maximum GPUs' });
    expect(maxGpus.getAttribute('aria-valuetext')).toBe('8 GPUs');
    const context = screen.getByRole('slider', { name: 'Minimum context' });
    expect(context.getAttribute('aria-valuetext')).toBe('32.8K tokens or more');
  });
});
