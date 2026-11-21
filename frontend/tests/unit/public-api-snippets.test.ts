import { describe, expect, it } from 'vitest';

import {
  ENDPOINTS,
  getEndpointKind,
  getEndpointKinds,
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

  it('has no endpoint for model types without a supported API', () => {
    expect(getEndpointKind('Reward_Modeling')).toBeNull();
  });
});

describe('getEndpointKinds', () => {
  it('offers chat completions and Responses for chat models, default first', () => {
    expect(getEndpointKinds('LLM')).toEqual(['chatCompletions', 'responses']);
    expect(getEndpointKinds(undefined)).toEqual([
      'chatCompletions',
      'responses',
    ]);
  });

  it('offers only embeddings for embedding models', () => {
    expect(getEndpointKinds('Text_Embedding')).toEqual(['embeddings']);
  });

  it('offers nothing for model types without a supported API', () => {
    expect(getEndpointKinds('Reward_Modeling')).toEqual([]);
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

describe('responses snippets', () => {
  const build = ENDPOINTS.responses.build;

  it('targets /responses with instructions and input from the prompts', () => {
    const curl = build(context).curl;
    expect(curl).toContain(`"${context.baseUrl}/responses"`);
    expect(curl).toContain(`Authorization: ${context.authorizationHeader}`);
    expect(curl).toContain('"instructions": "You are a helpful assistant."');
    expect(curl).toContain('"input": "Hello from LLMHub"');
    expect(curl).toContain('"stream": false');
    expect(curl).not.toContain('"messages"');
  });

  it('leaves out instructions when there is no system prompt', () => {
    const snippets = build({
      ...context,
      messages: [{ role: 'user', content: 'Hello from LLMHub' }],
    });
    expect(snippets.curl).not.toContain('instructions');
    expect(snippets.python).not.toContain('instructions');
    expect(snippets.javascript).not.toContain('instructions');
  });

  it('uses the Responses SDK call and output_text', () => {
    const snippets = build(context);
    expect(snippets.python).toContain('client.responses.create');
    expect(snippets.python).toContain('response.output_text');
    expect(snippets.javascript).toContain('client.responses.create');
    expect(snippets.javascript).toContain('response.output_text');
  });

  it('streams output_text delta events', () => {
    const snippets = build({ ...context, stream: true });
    expect(snippets.python).toContain('if True:');
    expect(snippets.python).toContain('"response.output_text.delta"');
    expect(snippets.javascript).toContain('if (true)');
    expect(snippets.javascript).toContain('"response.output_text.delta"');
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
