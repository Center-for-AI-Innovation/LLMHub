import { afterEach, describe, expect, it, vi } from 'vitest';

// The always-on env vars are read at module scope, so re-import per test.
async function loadModels(env: { model?: string; baseUrl?: string }) {
  vi.resetModules();
  vi.stubEnv('ALWAYS_ON_VLLM_MODEL', env.model ?? '');
  vi.stubEnv('ALWAYS_ON_VLLM_BASE_URL', env.baseUrl ?? '');
  return await import('@/lib/ai/models');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('lib/ai/models', () => {
  it('defaults the chat model to always-on-model', async () => {
    const { DEFAULT_CHAT_MODEL } = await loadModels({});
    expect(DEFAULT_CHAT_MODEL).toBe('always-on-model');
  });

  it('registers no always-on model when always-on is unconfigured', async () => {
    const { myProvider } = await loadModels({});
    expect(() => myProvider.languageModel('always-on-model')).toThrow();
  });

  it('does not register the always-on model when only the model name is set (no base URL)', async () => {
    const { myProvider } = await loadModels({ model: 'qwen' });
    expect(() => myProvider.languageModel('always-on-model')).toThrow();
  });

  it('registers always-on-model when both always-on model and base URL are set', async () => {
    const { myProvider } = await loadModels({
      model: 'Qwen/Qwen2.5-1.5B-Instruct',
      baseUrl: 'http://localhost:8000/v1',
    });

    expect(() => myProvider.languageModel('always-on-model')).not.toThrow();
  });
});