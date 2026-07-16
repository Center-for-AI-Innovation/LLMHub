import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  authMock,
  getUserByIdMock,
  getModelDeploymentByIdMock,
  canUserAccessDeploymentMock,
  handleChatCompletionsMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  getUserByIdMock: vi.fn(),
  getModelDeploymentByIdMock: vi.fn(),
  canUserAccessDeploymentMock: vi.fn(),
  handleChatCompletionsMock: vi.fn(),
}));

vi.mock('@/app/(auth)/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db/queries', () => ({
  getUserById: getUserByIdMock,
  getModelDeploymentById: getModelDeploymentByIdMock,
}));
vi.mock('@/lib/auth/validate-request', () => ({
  canUserAccessDeployment: canUserAccessDeploymentMock,
}));
vi.mock('@/lib/vllm-ai-sdk', () => ({
  isChatCompletionsEndpoint: (path: string[]) =>
    path.join('/') === 'chat/completions',
  handleChatCompletions: handleChatCompletionsMock,
}));

import { POST } from '@/app/api/v1/deployment/[deploymentId]/[...path]/route';

const DEPLOYMENT_ID = '0950c69e-fa62-4096-9bfc-b1baf31a944e';

const readyDeployment = {
  id: DEPLOYMENT_ID,
  slurmJobId: '123456',
  modelName: 'qwen-2.5-7b',
  endpointUrl: 'http://node1:8000',
  status: 'ready',
};

function makeContext(path: string[]) {
  return { params: Promise.resolve({ deploymentId: DEPLOYMENT_ID, path }) };
}

function makeRequest(path: string[]) {
  return new Request(
    `http://localhost/api/v1/deployment/${DEPLOYMENT_ID}/${path.join('/')}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'user-1' } });
  getUserByIdMock.mockResolvedValue({ id: 'user-1' });
  getModelDeploymentByIdMock.mockResolvedValue(readyDeployment);
  canUserAccessDeploymentMock.mockResolvedValue(true);
  handleChatCompletionsMock.mockResolvedValue(new Response('ok'));
});

describe('POST /api/v1/deployment/[deploymentId]/[...path]', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(
      makeRequest(['chat', 'completions']),
      makeContext(['chat', 'completions']),
    );

    expect(response.status).toBe(401);
    expect(getModelDeploymentByIdMock).not.toHaveBeenCalled();
  });

  it('looks up the deployment by deployment id, not Slurm job id', async () => {
    await POST(
      makeRequest(['chat', 'completions']),
      makeContext(['chat', 'completions']),
    );

    expect(getModelDeploymentByIdMock).toHaveBeenCalledWith(DEPLOYMENT_ID);
  });

  it('returns 404 naming the deployment id when the deployment is missing', async () => {
    getModelDeploymentByIdMock.mockResolvedValue(null);

    const response = await POST(
      makeRequest(['chat', 'completions']),
      makeContext(['chat', 'completions']),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.message).toContain(DEPLOYMENT_ID);
  });

  it('returns 403 when the user has no access to the deployment', async () => {
    canUserAccessDeploymentMock.mockResolvedValue(false);

    const response = await POST(
      makeRequest(['chat', 'completions']),
      makeContext(['chat', 'completions']),
    );

    expect(response.status).toBe(403);
    expect(handleChatCompletionsMock).not.toHaveBeenCalled();
  });

  it('returns 503 when the deployment is not ready', async () => {
    getModelDeploymentByIdMock.mockResolvedValue({
      ...readyDeployment,
      status: 'pending',
    });

    const response = await POST(
      makeRequest(['chat', 'completions']),
      makeContext(['chat', 'completions']),
    );

    expect(response.status).toBe(503);
  });

  it('delegates POST chat/completions to the AI SDK handler', async () => {
    const response = await POST(
      makeRequest(['chat', 'completions']),
      makeContext(['chat', 'completions']),
    );

    expect(response.status).toBe(200);
    expect(handleChatCompletionsMock).toHaveBeenCalledWith(
      expect.any(Request),
      readyDeployment,
      'user-1',
    );
  });

  it('proxies other paths to the deployment endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const response = await POST(
        makeRequest(['completions']),
        makeContext(['completions']),
      );

      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://node1:8000/v1/completions',
        expect.objectContaining({ method: 'POST' }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});