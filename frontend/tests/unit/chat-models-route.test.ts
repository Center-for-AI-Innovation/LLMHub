import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { authMock, getAccessibleDeploymentsMock, getAvailableModelsMock } =
  vi.hoisted(() => ({
    authMock: vi.fn(),
    getAccessibleDeploymentsMock: vi.fn(),
    getAvailableModelsMock: vi.fn(),
  }));

vi.mock('@/app/(auth)/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db/queries', () => ({
  getAccessibleDeploymentsByUserId: getAccessibleDeploymentsMock,
  getAvailableModels: getAvailableModelsMock,
}));

// The always-on env vars are read at module scope, so the route must be
// re-imported after stubbing the environment.
async function loadRoute(
  alwaysOnModel: string,
  alwaysOnBaseUrl = 'http://localhost:8000/v1',
) {
  vi.resetModules();
  vi.stubEnv('ALWAYS_ON_VLLM_MODEL', alwaysOnModel);
  vi.stubEnv('ALWAYS_ON_VLLM_BASE_URL', alwaysOnBaseUrl);
  return await import('@/app/api/chat/models/route');
}

// A deployment row as getAccessibleDeploymentsByUserId returns it: the
// NOT NULL columns the route reads are always present.
function deploymentRow(overrides: {
  id: string;
  modelName?: string;
  modelId?: string;
  slurmJobId?: string;
  status?: string;
  updatedAt?: string;
}) {
  return {
    modelName: overrides.id,
    modelId: overrides.id,
    slurmJobId: '100000',
    status: 'ready',
    ...overrides,
    updatedAt: new Date(overrides.updatedAt ?? '2026-07-01T00:00:00Z'),
  };
}

beforeEach(() => {
  authMock.mockReset();
  getAccessibleDeploymentsMock.mockReset();
  getAvailableModelsMock.mockReset();
  getAvailableModelsMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/chat/models', () => {
  it('returns an empty list when there is no session and no always-on model', async () => {
    authMock.mockResolvedValue(null);
    const { GET } = await loadRoute('');

    const response = await GET();
    expect(await response.json()).toEqual([]);
  });

  it('returns only the always-on option for anonymous users when configured', async () => {
    authMock.mockResolvedValue(null);
    const { GET } = await loadRoute('Qwen/Qwen2.5-1.5B-Instruct');

    const models = await (await GET()).json();
    expect(models).toEqual([
      {
        id: 'always-on-model',
        name: 'Qwen/Qwen2.5-1.5B-Instruct',
        description: 'Always-on model (Qwen/Qwen2.5-1.5B-Instruct)',
      },
    ]);
  });

  it('omits the always-on option when its base URL is not set', async () => {
    authMock.mockResolvedValue(null);
    const { GET } = await loadRoute('Qwen/Qwen2.5-1.5B-Instruct', '');

    const response = await GET();
    expect(await response.json()).toEqual([]);
  });

  it('lists active deployments keyed by deployment id, newest first, then always-on', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    getAccessibleDeploymentsMock.mockResolvedValue([
      deploymentRow({
        id: 'dep-old',
        modelName: 'llama-3-8b',
        slurmJobId: '111111',
        status: 'ready',
        updatedAt: '2026-07-01T00:00:00Z',
      }),
      deploymentRow({
        id: 'dep-new',
        modelName: 'qwen-2.5-7b',
        slurmJobId: '222222',
        status: 'running',
        updatedAt: '2026-07-10T00:00:00Z',
      }),
      deploymentRow({
        id: 'dep-stopped',
        modelName: 'stopped-model',
        slurmJobId: '333333',
        status: 'shutdown',
        updatedAt: '2026-07-12T00:00:00Z',
      }),
    ]);
    const { GET } = await loadRoute('always-on');

    const models = await (await GET()).json();
    expect(models.map((model: { id: string }) => model.id)).toEqual([
      'vllm-deployment:dep-new',
      'vllm-deployment:dep-old',
      'always-on-model',
    ]);
    expect(models[0]).toEqual({
      id: 'vllm-deployment:dep-new',
      name: 'qwen-2.5-7b',
      description: 'Active deployment (running)',
    });
  });

  it('does not collapse distinct deployments that reuse a Slurm job id', async () => {
    // Regression guard for issue #26: Slurm reuses job ids, so two different
    // deployments may share one. Both must remain selectable.
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    getAccessibleDeploymentsMock.mockResolvedValue([
      deploymentRow({
        id: 'dep-a',
        modelName: 'model-a',
        slurmJobId: '123456',
        updatedAt: '2026-07-10T00:00:00Z',
      }),
      deploymentRow({
        id: 'dep-b',
        modelName: 'model-b',
        slurmJobId: '123456',
        updatedAt: '2026-07-09T00:00:00Z',
      }),
    ]);
    const { GET } = await loadRoute('');

    const models = await (await GET()).json();
    expect(models.map((model: { id: string }) => model.id)).toEqual([
      'vllm-deployment:dep-a',
      'vllm-deployment:dep-b',
    ]);
  });

  it('excludes deployments of models that cannot chat', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    getAccessibleDeploymentsMock.mockResolvedValue([
      deploymentRow({ id: 'dep-llm', modelId: 'llm' }),
      deploymentRow({ id: 'dep-vlm', modelId: 'vlm' }),
      deploymentRow({ id: 'dep-untyped', modelId: 'untyped' }),
      deploymentRow({ id: 'dep-embed', modelId: 'embed' }),
      deploymentRow({ id: 'dep-reward', modelId: 'reward' }),
    ]);
    getAvailableModelsMock.mockResolvedValue([
      { id: 'llm', modelType: 'LLM' },
      { id: 'vlm', modelType: 'VLM' },
      { id: 'untyped', modelType: null },
      { id: 'embed', modelType: 'Text_Embedding' },
      { id: 'reward', modelType: 'Reward_Modeling' },
    ]);
    const { GET } = await loadRoute('');

    const models = await (await GET()).json();
    expect(models.map((model: { id: string }) => model.id)).toEqual([
      'vllm-deployment:dep-llm',
      'vllm-deployment:dep-vlm',
      'vllm-deployment:dep-untyped',
    ]);
  });

  it('falls back to the always-on option when the deployment query fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    getAccessibleDeploymentsMock.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { GET } = await loadRoute('always-on');

    const models = await (await GET()).json();
    expect(models.map((model: { id: string }) => model.id)).toEqual([
      'always-on-model',
    ]);
  });
});
