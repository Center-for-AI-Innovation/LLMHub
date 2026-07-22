import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createOpenAIMock, chatMock } = vi.hoisted(() => {
  const chatMock = vi.fn(() => ({}));
  return {
    chatMock,
    createOpenAIMock: vi.fn(() => ({ chat: chatMock })),
  };
});

vi.mock('@ai-sdk/openai', () => ({ createOpenAI: createOpenAIMock }));
vi.mock('@/lib/db/queries', () => ({
  getChatById: vi.fn(),
  saveChat: vi.fn(),
  saveMessages: vi.fn(),
}));

import {
  createVllmProvider,
  handleChatCompletions,
  isChatCompletionsEndpoint,
} from '@/lib/vllm-ai-sdk';

beforeEach(() => {
  createOpenAIMock.mockClear();
  chatMock.mockClear();
});

describe('isChatCompletionsEndpoint', () => {
  it('matches only the chat/completions path', () => {
    expect(isChatCompletionsEndpoint(['chat', 'completions'])).toBe(true);
    expect(isChatCompletionsEndpoint(['models'])).toBe(false);
    expect(isChatCompletionsEndpoint(['completions'])).toBe(false);
    expect(isChatCompletionsEndpoint(['chat', 'completions', 'x'])).toBe(false);
  });
});

describe('createVllmProvider', () => {
  it('throws when the deployment has no endpoint URL', () => {
    expect(() => createVllmProvider({ id: 'dep-1' } as never)).toThrow(
      'No endpoint URL available for deployment',
    );
  });

  it('normalizes a trailing /v1 so it is not duplicated', () => {
    createVllmProvider({ id: 'dep-1', endpointUrl: 'http://node1:8000/v1/' } as never);
    expect(createOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'http://node1:8000/v1' }),
    );
  });

  it('appends /v1 when the endpoint URL lacks it', () => {
    createVllmProvider({ id: 'dep-1', endpointUrl: 'http://node1:8000' } as never);
    expect(createOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'http://node1:8000/v1' }),
    );
  });
});

describe('handleChatCompletions', () => {
  const makeRequest = (body: unknown) =>
    new Request('http://localhost/api/v1/deployment/dep-123/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('returns 400 when there is no user message', async () => {
    const response = await handleChatCompletions(
      makeRequest({ messages: [] }),
      { id: 'dep-123', endpointUrl: 'http://node1:8000' } as never,
      'user-1',
    );

    expect(response.status).toBe(400);
  });

  it('returns 500 naming the deployment when no model name is configured', async () => {
    const response = await handleChatCompletions(
      makeRequest({
        messages: [
          { id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
        ],
      }),
      {
        id: 'dep-123',
        endpointUrl: 'http://node1:8000',
        modelName: null,
        status: 'ready',
      } as never,
      'user-1',
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    // The message must identify WHICH deployment is misconfigured, i.e.
    // contain the actual deployment id, not a literal "${deployment.id}".
    expect(body.error.message).toContain('dep-123');
    expect(body.error.message).not.toContain('${deployment.id}');
  });
});
