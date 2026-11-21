import { isChatModelType, isEmbeddingModelType } from '@/lib/models/types';

export type SnippetLanguage = 'curl' | 'python' | 'javascript';

export type SnippetSet = Record<SnippetLanguage, string>;

export type SnippetContext = {
  baseUrl: string;
  authorizationHeader: string;
  apiKey: string;
  modelName: string;
  prompt: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  stream: boolean;
};

export type SnippetBuilder = (context: SnippetContext) => SnippetSet;

export type RequestEditor = 'messages' | 'input';

export type EndpointConfig = {
  label: string;
  build: SnippetBuilder;
  requestEditor: RequestEditor;
  supportsStreaming: boolean;
  labelSuffix: string | null;
};

export type EndpointKind = 'chatCompletions' | 'responses' | 'embeddings';

function curlPost(url: string, authorizationHeader: string, body: unknown) {
  return `curl -X POST "${url}" \\
  -H "Authorization: ${authorizationHeader}" \\
  -H "Content-Type: application/json" \\
  -d @- <<'JSON'
${JSON.stringify(body, null, 2)}
JSON`;
}

function pythonClient(baseUrl: string, apiKey: string) {
  return `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}",
    api_key="${apiKey}",
)`;
}

function jsClient(baseUrl: string, apiKey: string) {
  return `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${baseUrl}",
  apiKey: "${apiKey}",
});`;
}

const buildChatCompletions: SnippetBuilder = ({
  baseUrl,
  authorizationHeader,
  apiKey,
  modelName,
  messages,
  stream,
}) => ({
  curl: curlPost(`${baseUrl}/chat/completions`, authorizationHeader, {
    model: modelName,
    messages,
    stream,
  }),
  python: `${pythonClient(baseUrl, apiKey)}

messages = ${JSON.stringify(messages, null, 4)}

if ${stream ? 'True' : 'False'}:
    stream = client.chat.completions.create(
        model="${modelName}",
        messages=messages,
        stream=True,
    )

    for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            print(delta, end="")
    print()
else:
    response = client.chat.completions.create(
        model="${modelName}",
        messages=messages,
        stream=False,
    )

    print(response.choices[0].message.content)`,
  javascript: `${jsClient(baseUrl, apiKey)}

const messages = ${JSON.stringify(messages, null, 2)};

if (${stream ? 'true' : 'false'}) {
  const stream = await client.chat.completions.create({
    model: "${modelName}",
    messages,
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) process.stdout.write(delta);
  }
  process.stdout.write("\\n");
} else {
  const response = await client.chat.completions.create({
    model: "${modelName}",
    messages,
    stream: false,
  });

  console.log(response.choices[0]?.message?.content);
}`,
});

// Responses API: the system prompt becomes `instructions`, the user prompt
// `input`; the reply text is `output_text`.
const buildResponses: SnippetBuilder = ({
  baseUrl,
  authorizationHeader,
  apiKey,
  modelName,
  messages,
  stream,
}) => {
  const instructions = messages.find((m) => m.role === 'system')?.content;
  const input = messages.find((m) => m.role === 'user')?.content ?? '';
  const pyInstructions = instructions
    ? `\n        instructions=${JSON.stringify(instructions)},`
    : '';
  const jsInstructions = instructions
    ? `\n    instructions: ${JSON.stringify(instructions)},`
    : '';

  return {
    curl: curlPost(`${baseUrl}/responses`, authorizationHeader, {
      model: modelName,
      ...(instructions ? { instructions } : {}),
      input,
      stream,
    }),
    python: `${pythonClient(baseUrl, apiKey)}

if ${stream ? 'True' : 'False'}:
    stream = client.responses.create(
        model="${modelName}",${pyInstructions}
        input=${JSON.stringify(input)},
        stream=True,
    )

    for event in stream:
        if event.type == "response.output_text.delta":
            print(event.delta, end="")
    print()
else:
    response = client.responses.create(
        model="${modelName}",${pyInstructions}
        input=${JSON.stringify(input)},
    )

    print(response.output_text)`,
    javascript: `${jsClient(baseUrl, apiKey)}

if (${stream ? 'true' : 'false'}) {
  const stream = await client.responses.create({
    model: "${modelName}",${jsInstructions}
    input: ${JSON.stringify(input)},
    stream: true,
  });

  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      process.stdout.write(event.delta);
    }
  }
  process.stdout.write("\\n");
} else {
  const response = await client.responses.create({
    model: "${modelName}",${jsInstructions}
    input: ${JSON.stringify(input)},
  });

  console.log(response.output_text);
}`,
  };
};

const buildEmbeddings: SnippetBuilder = ({
  baseUrl,
  authorizationHeader,
  apiKey,
  modelName,
  prompt,
}) => ({
  curl: curlPost(`${baseUrl}/embeddings`, authorizationHeader, {
    model: modelName,
    input: prompt,
  }),
  python: `${pythonClient(baseUrl, apiKey)}

response = client.embeddings.create(
    model="${modelName}",
    input=${JSON.stringify(prompt)},
)

embedding = response.data[0].embedding
print(f"Dimensions: {len(embedding)}")
print(f"First values: {embedding[:5]}")`,
  javascript: `${jsClient(baseUrl, apiKey)}

const response = await client.embeddings.create({
  model: "${modelName}",
  input: ${JSON.stringify(prompt)},
});

const embedding = response.data[0].embedding;
console.log(\`Dimensions: \${embedding.length}\`);
console.log(\`First values: \${embedding.slice(0, 5)}\`);`,
});

export const ENDPOINTS: Record<EndpointKind, EndpointConfig> = {
  chatCompletions: {
    label: 'Chat Completions',
    build: buildChatCompletions,
    requestEditor: 'messages',
    supportsStreaming: true,
    labelSuffix: null,
  },
  responses: {
    label: 'Responses',
    build: buildResponses,
    requestEditor: 'messages',
    supportsStreaming: true,
    labelSuffix: null,
  },
  embeddings: {
    label: 'Embeddings',
    build: buildEmbeddings,
    requestEditor: 'input',
    supportsStreaming: false,
    labelSuffix: 'Embedding',
  },
};

// null: the model type has no public API endpoint yet (e.g. Reward_Modeling).
export function getEndpointKind(
  modelType: string | undefined,
): EndpointKind | null {
  if (isEmbeddingModelType(modelType)) return 'embeddings';
  if (isChatModelType(modelType)) return 'chatCompletions';
  return null;
}

// Every endpoint the model type can use, default first. Chat models can use
// chat completions or the Responses API; the API dialog lets the user pick.
export function getEndpointKinds(
  modelType: string | undefined,
): EndpointKind[] {
  const kind = getEndpointKind(modelType);
  if (kind === 'chatCompletions') return ['chatCompletions', 'responses'];
  return kind ? [kind] : [];
}
