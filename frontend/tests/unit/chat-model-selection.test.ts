import { describe, expect, it } from 'vitest';
import { pickChatModel } from '@/lib/chat-model-selection';

const options = [
  { id: 'vllm-deployment:dep-new' },
  { id: 'vllm-deployment:dep-old' },
  { id: 'always-on-model' },
];

describe('pickChatModel', () => {
  it('defaults to the first option when no deployment is requested', () => {
    expect(pickChatModel(options, null)).toEqual({
      modelId: 'vllm-deployment:dep-new',
      deploymentUnavailable: false,
    });
  });

  it('selects the requested deployment when it is accessible', () => {
    expect(pickChatModel(options, 'dep-old')).toEqual({
      modelId: 'vllm-deployment:dep-old',
      deploymentUnavailable: false,
    });
  });

  it('falls back to the default and flags an unknown or inaccessible deployment', () => {
    expect(pickChatModel(options, 'dep-someone-elses')).toEqual({
      modelId: 'vllm-deployment:dep-new',
      deploymentUnavailable: true,
    });
  });

  it('selects nothing and flags the deployment when the list is empty', () => {
    expect(pickChatModel([], 'dep-gone')).toEqual({
      modelId: null,
      deploymentUnavailable: true,
    });
  });

  it('selects nothing when the list is empty and no deployment is requested', () => {
    expect(pickChatModel([], null)).toEqual({
      modelId: null,
      deploymentUnavailable: false,
    });
  });
});
