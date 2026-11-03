import { describe, expect, it } from 'vitest';

import { buildDeploymentTargetUrl } from '@/lib/utils';

describe('buildDeploymentTargetUrl', () => {
  it('appends the endpoint path to a bare origin', () => {
    expect(buildDeploymentTargetUrl('http://node1:8000', 'embeddings')).toBe(
      'http://node1:8000/v1/embeddings',
    );
  });

  it('strips a trailing /v1', () => {
    expect(buildDeploymentTargetUrl('http://node1:8000/v1', 'embeddings')).toBe(
      'http://node1:8000/v1/embeddings',
    );
  });

  it('strips a trailing /v1/', () => {
    expect(
      buildDeploymentTargetUrl('http://node1:8000/v1/', 'embeddings'),
    ).toBe('http://node1:8000/v1/embeddings');
  });

  it('strips a trailing slash', () => {
    expect(buildDeploymentTargetUrl('http://node1:8000/', 'embeddings')).toBe(
      'http://node1:8000/v1/embeddings',
    );
  });

  it('builds chat completions targets the same way', () => {
    expect(
      buildDeploymentTargetUrl('http://node1:8000/v1', 'chat/completions'),
    ).toBe('http://node1:8000/v1/chat/completions');
  });
});
