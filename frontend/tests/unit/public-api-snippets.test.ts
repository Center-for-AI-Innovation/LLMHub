import { describe, expect, it } from 'vitest';

import {
  ENDPOINTS,
  getEndpointKind,
  type SnippetContext,
} from '@/lib/public-api-snippets';

const context: SnippetContext = {
  baseUrl: 'https://example.com/api/public/v1/deployment/abc',
  authorizationHeader: 'Bearer test-key',
  apiKey: 'test-key',
  modelName: 'test-model',
  prompt: 'Hello from LLMHub',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello from LLMHub' },
  ],
  stream: false,
};

describe('getEndpointKind', () => {
  it('maps embedding model types to the embeddings endpoint', () => {
    expect(getEndpointKind('Text_Embedding')).toBe('embeddings');
  });

  it('falls back to chat completions', () => {
    expect(getEndpointKind('LLM')).toBe('chatCompletions');
    expect(getEndpointKind(undefined)).toBe('chatCompletions');
  });
});

describe('chatCompletions snippets', () => {
  const build = ENDPOINTS.chatCompletions.build;

  it('targets /chat/completions with the auth header and body', () => {
    const curl = build(context).curl;
    expect(curl).toContain(`"${context.baseUrl}/chat/completions"`);
    expect(curl).toContain(`Authorization: ${context.authorizationHeader}`);
    expect(curl).toContain(`"model": "test-model"`);
    expect(curl).toContain('"stream": false');
  });

  it('reflects the stream flag in python', () => {
    expect(build({ ...context, stream: true }).python).toContain('if True:');
    expect(build(context).python).toContain('if False:');
  });

  it('uses the chat completions SDK call', () => {
    expect(build(context).python).toContain('client.chat.completions.create');
    expect(build(context).javascript).toContain(
      'client.chat.completions.create',
    );
  });
});

describe('embeddings snippets', () => {
  const build = ENDPOINTS.embeddings.build;

  it('targets /embeddings with the input text', () => {
    const curl = build(context).curl;
    expect(curl).toContain(`"${context.baseUrl}/embeddings"`);
    expect(curl).toContain(`"input": "Hello from LLMHub"`);
  });

  it('uses the embeddings SDK call without streaming', () => {
    const snippets = build(context);
    expect(snippets.python).toContain('client.embeddings.create');
    expect(snippets.javascript).toContain('client.embeddings.create');
    expect(snippets.python).not.toContain('stream');
    expect(snippets.javascript).not.toContain('stream');
  });
});
