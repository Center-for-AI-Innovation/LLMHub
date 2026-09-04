import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getUserFromApiKeyMock,
  getModelDeploymentByIdMock,
  canUserAccessDeploymentMock,
} = vi.hoisted(() => ({
  getUserFromApiKeyMock: vi.fn(),
  getModelDeploymentByIdMock: vi.fn(),
  canUserAccessDeploymentMock: vi.fn(),
}));

vi.mock('@/lib/security/api-keys', () => ({
  extractBearerApiKey: (header: string | null) =>
    header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null,
  getUserFromApiKey: getUserFromApiKeyMock,
}));
vi.mock('@/lib/db/queries', () => ({
  getModelDeploymentById: getModelDeploymentByIdMock,
}));
vi.mock('@/lib/auth/validate-request', () => ({
  canUserAccessDeployment: canUserAccessDeploymentMock,
}));

import { POST } from '@/app/api/public/v1/deployment/[deploymentId]/chat/completions/route';

const DEPLOYMENT_ID = '0950c69e-fa62-4096-9bfc-b1baf31a944e';

const readyDeployment = {
  id: DEPLOYMENT_ID,
  slurmJobId: '123456',
  modelName: 'qwen-2.5-7b',
  endpointUrl: 'http://node1:8000/v1',
  status: 'running',
};

function makeRequest(authorization?: string) {
  return new Request(
    `http://localhost/api/public/v1/deployment/${DEPLOYMENT_ID}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    },
  );
}

const context = {
  params: Promise.resolve({ deploymentId: DEPLOYMENT_ID }),
};

beforeEach(() => {
  vi.clearAllMocks();
  getUserFromApiKeyMock.mockResolvedValue({ id: 'user-1' });
  getModelDeploymentByIdMock.mockResolvedValue(readyDeployment);
  canUserAccessDeploymentMock.mockResolvedValue(true);
});

describe('POST /api/public/v1/deployment/[deploymentId]/chat/completions', () => {
  it('returns 401 without an Authorization header', async () => {
    const response = await POST(makeRequest(), context);
    expect(response.status).toBe(401);
  });

  it('returns 401 for an invalid API key', async () => {
    getUserFromApiKeyMock.mockResolvedValue(null);

    const response = await POST(makeRequest('Bearer bad-key'), context);
    expect(response.status).toBe(401);
  });

  it('looks up the deployment by deployment id and 404s when missing', async () => {
    getModelDeploymentByIdMock.mockResolvedValue(null);

    const response = await POST(makeRequest('Bearer good-key'), context);

    expect(getModelDeploymentByIdMock).toHaveBeenCalledWith(DEPLOYMENT_ID);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.message).toContain(DEPLOYMENT_ID);
  });

  it('returns 403 when the key owner has no access to the deployment', async () => {
    canUserAccessDeploymentMock.mockResolvedValue(false);

    const response = await POST(makeRequest('Bearer good-key'), context);
    expect(response.status).toBe(403);
  });

  it('returns 503 when the deployment is not ready or running', async () => {
    getModelDeploymentByIdMock.mockResolvedValue({
      ...readyDeployment,
      status: 'stopped',
    });

    const response = await POST(makeRequest('Bearer good-key'), context);
    expect(response.status).toBe(503);
  });

  it('proxies the request body to the deployment chat completions endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const response = await POST(makeRequest('Bearer good-key'), context);

      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://node1:8000/v1/chat/completions',
        expect.objectContaining({ method: 'POST' }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});