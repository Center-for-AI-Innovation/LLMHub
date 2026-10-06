import { describe, expect, it } from 'vitest';
import {
  resolveChatModelSelection,
  type ChatModelSelectionState,
} from '@/lib/chat-model-selection';

const initialState: ChatModelSelectionState = {
  handledDeploymentId: null,
  initialized: false,
};

const staleOptions = [
  { id: 'vllm-deployment:dep-old' },
  { id: 'always-on-model' },
];
const freshOptions = [
  { id: 'vllm-deployment:dep-new' },
  ...staleOptions,
];

describe('resolveChatModelSelection', () => {
  it('does nothing until options are loaded', () => {
    const result = resolveChatModelSelection({
      chatModelOptions: [],
      deploymentIdFromUrl: 'dep-new',
      isFetchedAfterMount: false,
      state: initialState,
    });

    expect(result).toEqual({ modelId: null, state: initialState });
  });

  it('defaults to the first option when no deployment is requested', () => {
    const result = resolveChatModelSelection({
      chatModelOptions: staleOptions,
      deploymentIdFromUrl: null,
      isFetchedAfterMount: true,
      state: initialState,
    });

    expect(result.modelId).toBe('vllm-deployment:dep-old');
    expect(result.state.initialized).toBe(true);
  });

  it('selects the requested deployment when it is accessible', () => {
    const result = resolveChatModelSelection({
      chatModelOptions: freshOptions,
      deploymentIdFromUrl: 'dep-old',
      isFetchedAfterMount: true,
      state: initialState,
    });

    expect(result.modelId).toBe('vllm-deployment:dep-old');
    expect(result.state).toEqual({
      handledDeploymentId: 'dep-old',
      initialized: true,
    });
  });

  it('falls back to the default for an unknown or inaccessible deployment', () => {
    const result = resolveChatModelSelection({
      chatModelOptions: freshOptions,
      deploymentIdFromUrl: 'dep-someone-elses',
      isFetchedAfterMount: true,
      state: initialState,
    });

    expect(result.modelId).toBe('vllm-deployment:dep-new');
    expect(result.state.handledDeploymentId).toBe('dep-someone-elses');
  });

  it('selects the requested deployment once fresh options replace a stale cache', () => {
    const fromCache = resolveChatModelSelection({
      chatModelOptions: staleOptions,
      deploymentIdFromUrl: 'dep-new',
      isFetchedAfterMount: false,
      state: initialState,
    });
    expect(fromCache.modelId).toBe('vllm-deployment:dep-old');
    expect(fromCache.state.handledDeploymentId).toBeNull();

    const fromFetch = resolveChatModelSelection({
      chatModelOptions: freshOptions,
      deploymentIdFromUrl: 'dep-new',
      isFetchedAfterMount: true,
      state: fromCache.state,
    });
    expect(fromFetch.modelId).toBe('vllm-deployment:dep-new');
  });

  it('does not override a later manual selection on refetch', () => {
    const handled = resolveChatModelSelection({
      chatModelOptions: freshOptions,
      deploymentIdFromUrl: 'dep-new',
      isFetchedAfterMount: true,
      state: initialState,
    });

    const refetched = resolveChatModelSelection({
      chatModelOptions: [...freshOptions],
      deploymentIdFromUrl: 'dep-new',
      isFetchedAfterMount: true,
      state: handled.state,
    });
    expect(refetched.modelId).toBeNull();
  });
});
