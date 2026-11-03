import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getUserFromApiKeyMock,
  getModelDeploymentByIdMock,
  canUserAccessDeploymentMock,
  getDeploymentUpstreamKeyMock,
} = vi.hoisted(() => ({
  getUserFromApiKeyMock: vi.fn(),
  getModelDeploymentByIdMock: vi.fn(),
  canUserAccessDeploymentMock: vi.fn(),
  getDeploymentUpstreamKeyMock: vi.fn(),
}));

vi.mock('@/lib/security/api-keys', () => ({
  extractBearerApiKey: (header: string | null) =>
    header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null,
  getUserFromApiKey: getUserFromApiKeyMock,
}));
vi.mock('@/lib/db/queries', () => ({
  getModelDeploymentById: getModelDeploymentByIdMock,
  getDeploymentUpstreamKey: getDeploymentUpstreamKeyMock,
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/validate-request', () => ({
  canUserAccessDeployment: canUserAccessDeploymentMock,
}));

import { POST } from '@/app/api/public/v1/deployment/[deploymentId]/responses/route';

const DEPLOYMENT_ID = '0950c69e-fa62-4096-9bfc-b1baf31a944e';

const readyDeployment = {
  id: DEPLOYMENT_ID,
  slurmJobId: '123456',
  modelName: 'Qwen2.5-0.5B-Instruct',
  endpointUrl: 'http://node1:8000/v1',
  status: 'running',
};

const REQUEST_BODY = JSON.stringify({
  model: 'Qwen2.5-0.5B-Instruct',
  input: 'Say hi',
});

function makeRequest(authorization?: string) {
  return new Request(
    `http://localhost/api/public/v1/deployment/${DEPLOYMENT_ID}/responses`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: REQUEST_BODY,
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
  getDeploymentUpstreamKeyMock.mockResolvedValue(null);
});

describe('POST /api/public/v1/deployment/[deploymentId]/responses', () => {
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

  it('proxies the request body to the deployment responses endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"object":"response","output":[]}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const response = await POST(makeRequest('Bearer good-key'), context);

      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://node1:8000/v1/responses',
        expect.objectContaining({ method: 'POST', body: REQUEST_BODY }),
      );
      expect(response.headers.get('Content-Type')).toBe('application/json');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('passes upstream error responses through', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"error":{"message":"input is too long"}}', {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const response = await POST(makeRequest('Bearer good-key'), context);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.message).toBe('input is too long');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sends vLLM the deployment's key, never the caller's LLMHub key", async () => {
    getDeploymentUpstreamKeyMock.mockResolvedValue('deployment-key');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await POST(makeRequest('Bearer llmhub_caller-key'), context);

      expect(getDeploymentUpstreamKeyMock).toHaveBeenCalledWith(DEPLOYMENT_ID);
      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers.Authorization).toBe('Bearer deployment-key');
      expect(JSON.stringify(init)).not.toContain('llmhub_caller-key');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('passes a streamed response through as an event stream', async () => {
    const events =
      'event: response.output_text.delta\ndata: {"delta":"Hi"}\n\n' +
      'event: response.completed\ndata: {}\n\n';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(events, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const response = await POST(makeRequest('Bearer good-key'), context);

      expect(response.headers.get('Content-Type')).toBe('text/event-stream');
      expect(await response.text()).toBe(events);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("passes vLLM's 404 for previous_response_id through, since nothing is stored", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        // vLLM's _make_not_found_error (entrypoints/openai/responses/serving.py)
        JSON.stringify({
          error: {
            message: "Response with id 'resp_123' not found.",
            type: 'invalid_request_error',
            param: 'response_id',
            code: 404,
          },
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const response = await POST(makeRequest('Bearer good-key'), context);

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error.message).toContain('not found');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
