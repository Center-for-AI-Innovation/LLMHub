import { describe, expect, it } from 'vitest';
import {
  getVllmChatEndpoint,
  getVllmModelsEndpoint,
} from '@/hooks/use-vllm-job';

describe('getVllmChatEndpoint', () => {
  it('builds the deployment-scoped chat completions path', () => {
    expect(getVllmChatEndpoint('0950c69e-fa62-4096-9bfc-b1baf31a944e')).toBe(
      '/api/v1/deployment/0950c69e-fa62-4096-9bfc-b1baf31a944e/chat/completions',
    );
  });

  it('does not reference the legacy job route', () => {
    expect(getVllmChatEndpoint('abc')).not.toContain('/api/v1/job/');
  });
});

describe('getVllmModelsEndpoint', () => {
  it('builds the deployment-scoped models path', () => {
    expect(getVllmModelsEndpoint('dep-1')).toBe(
      '/api/v1/deployment/dep-1/models',
    );
  });
});