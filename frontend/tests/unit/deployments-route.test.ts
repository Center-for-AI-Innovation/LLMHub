import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authMock, addUserToDeploymentMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  addUserToDeploymentMock: vi.fn(),
}));

vi.mock('@/app/(auth)/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db/queries', () => ({
  addUserToDeployment: addUserToDeploymentMock,
}));

import { POST } from '@/app/api/deployments/route';

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/deployments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/deployments', () => {
  beforeEach(() => {
    authMock.mockReset();
    addUserToDeploymentMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('forwards the selected account and session-derived cluster username', async () => {
    authMock.mockResolvedValue({
      user: { id: 'user-1', email: 'alice_13@illinois.edu' },
    });
    addUserToDeploymentMock.mockResolvedValue({ id: 'auth-1' });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'deployment-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      makeRequest({
        modelId: 'Qwen/Qwen3-8B',
        time: '00:30:00',
        partition: 'gpuA40x4',
        resource_type: 'A40',
        account: 'bgns-delta-gpu',
        clusterUsername: 'attacker',
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}'),
    );
    expect(payload.account).toBe('bgns-delta-gpu');
    expect(payload.clusterUsername).toBe('alice_13');
    expect(payload.userId).toBe('user-1');
  });

  it('strips the prefix before + when deriving the cluster username', async () => {
    authMock.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'rohan13+svcllmhubrohan13@ncsa.illinois.edu',
      },
    });
    addUserToDeploymentMock.mockResolvedValue({ id: 'auth-1' });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'deployment-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      makeRequest({
        modelId: 'Qwen/Qwen3-8B',
        time: '00:30:00',
        partition: 'gpuA40x4',
        resource_type: 'A40',
        account: 'bfmz-delta-gpu',
      }),
    );

    expect(response.status).toBe(200);
    const payload = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}'),
    );
    expect(payload.clusterUsername).toBe('svcllmhubrohan13');
  });
});
