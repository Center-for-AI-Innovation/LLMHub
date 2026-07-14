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

  it('registers no vllm-model and exposes no chat models when always-on is unconfigured', async () => {
    const { chatModels, myProvider } = await loadModels({});
    expect(chatModels).toEqual([]);
    expect(() => myProvider.languageModel('vllm-model')).toThrow();
  });

  it('does not register vllm-model when only the model name is set (no base URL)', async () => {
    const { myProvider } = await loadModels({ model: 'qwen' });
    expect(() => myProvider.languageModel('vllm-model')).toThrow();
  });

  it('registers vllm-model when both always-on model and base URL are set', async () => {
    const { chatModels, myProvider } = await loadModels({
      model: 'Qwen/Qwen2.5-1.5B-Instruct',
      baseUrl: 'http://localhost:8000/v1',
    });

    expect(chatModels).toEqual([
      {
        id: 'vllm-model',
        name: 'Qwen/Qwen2.5-1.5B-Instruct',
        description: 'Deployed vLLM model (Qwen/Qwen2.5-1.5B-Instruct)',
      },
    ]);
    expect(() => myProvider.languageModel('vllm-model')).not.toThrow();
  });
});