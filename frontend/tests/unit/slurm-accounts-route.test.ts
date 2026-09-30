import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
}));

vi.mock('@/app/(auth)/auth', () => ({ auth: authMock }));

import { GET } from '@/app/api/slurm-accounts/route';

describe('GET /api/slurm-accounts', () => {
  beforeEach(() => {
    authMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('returns 401 when there is no session', async () => {
    authMock.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 when the email cannot be mapped to a cluster username', async () => {
    authMock.mockResolvedValue({
      user: { id: 'user-1', email: '../alice@illinois.edu' },
    });

    const response = await GET();

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error:
        'Could not determine your cluster username from the signed-in email.',
    });
  });

  it('forwards the session-derived cluster username to the backend', async () => {
    authMock.mockResolvedValue({
      user: { id: 'user-1', email: 'alice_13@illinois.edu' },
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        accounts: ['proj-delta-cpu', 'proj-delta-gpu'],
        defaultAccount: 'proj-delta-gpu',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestedUrl).toContain('/api/models/slurm-accounts');
    expect(requestedUrl).toContain('clusterUsername=alice_13');
    expect(await response.json()).toEqual({
      accounts: ['proj-delta-cpu', 'proj-delta-gpu'],
      defaultAccount: 'proj-delta-gpu',
    });
  });

  it('strips the prefix before + when deriving the cluster username', async () => {
    authMock.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'rohan13+svcllmhubrohan13@ncsa.illinois.edu',
      },
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        accounts: ['bfmz-delta-gpu'],
        defaultAccount: 'bfmz-delta-gpu',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET();

    const requestedUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestedUrl).toContain('clusterUsername=svcllmhubrohan13');
    expect(response.status).toBe(200);
  });
});
