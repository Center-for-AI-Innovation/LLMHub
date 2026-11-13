// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PublicApiDialog } from '@/components/public-api-dialog';
import type { ModelDeployment } from '@/hooks/use-models';

const modelTypes: Record<string, string | undefined> = {
  'chat-model': 'LLM',
  'embed-model': 'Text_Embedding',
};

vi.mock('@/hooks/use-models', () => ({
  useDeploymentModelType:
    () =>
    (deployment: { modelId: string }) =>
      modelTypes[deployment.modelId],
}));
vi.mock('@/hooks/use-api-key', () => ({
  useGenerateApiKey: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// Radix Select uses pointer capture and scrollIntoView, which jsdom lacks.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

function deployment(modelId: string): ModelDeployment {
  return {
    id: `dep-${modelId}`,
    modelId,
    modelName: modelId,
    userId: 'user-1',
    slurmJobId: '1',
    status: 'ready',
  } as ModelDeployment;
}

function openDialog(modelId: string) {
  render(
    <PublicApiDialog
      deployments={[deployment(modelId)]}
      trigger={<button type="button">Open API</button>}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open API' }));
}

function curlSnippet() {
  return screen.getByText(/curl -X POST/).textContent ?? '';
}

describe('PublicApiDialog endpoint choice', () => {
  it('defaults chat models to chat completions and switches to Responses', () => {
    openDialog('chat-model');
    expect(curlSnippet()).toContain('/chat/completions');

    const select = screen.getByRole('combobox', { name: 'Endpoint' });
    fireEvent.pointerDown(select, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(screen.getByRole('option', { name: 'Responses' }));

    expect(curlSnippet()).toContain('/responses');
    expect(curlSnippet()).toContain('"instructions"');
    expect(curlSnippet()).not.toContain('/chat/completions');
  });

  it('has no endpoint choice for embedding models', () => {
    openDialog('embed-model');
    expect(screen.queryByRole('combobox', { name: 'Endpoint' })).toBeNull();
    expect(curlSnippet()).toContain('/embeddings');
  });
});
