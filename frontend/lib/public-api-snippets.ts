import { isEmbeddingModelType } from '@/lib/models/types';

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
  build: SnippetBuilder;
  requestEditor: RequestEditor;
  supportsStreaming: boolean;
  labelSuffix: string | null;
};

export type EndpointKind = 'chatCompletions' | 'embeddings';

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
    build: buildChatCompletions,
    requestEditor: 'messages',
    supportsStreaming: true,
    labelSuffix: null,
  },
  embeddings: {
    build: buildEmbeddings,
    requestEditor: 'input',
    supportsStreaming: false,
    labelSuffix: 'Embedding',
  },
};

export function getEndpointKind(modelType: string | undefined): EndpointKind {
  return isEmbeddingModelType(modelType) ? 'embeddings' : 'chatCompletions';
}
