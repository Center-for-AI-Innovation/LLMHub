# Embeddings

```text
POST /api/public/v1/deployment/{deploymentId}/embeddings
```

An OpenAI-compatible embeddings endpoint for deployments of embedding models,
such as `bge-base-en-v1.5`, `all-MiniLM-L6-v2` and `e5-mistral-7b-instruct`.
It turns text into vectors you can use for search,
clustering or retrieval-augmented generation. LLMHub checks your key and
access, then passes the request unchanged to the deployment's
[vLLM](https://docs.vllm.ai) server, so anything vLLM's `/v1/embeddings`
accepts works here.

Embedding models only answer this endpoint: they can't chat, so their cards in
**Your Active Models** have no **Chat** button. Chat models use
[chat completions](chat-completions.md) instead.

The examples use placeholders. Replace them with the values from the
deployment's **API** dialog, which shows embeddings examples for embedding
models:

- `https://your-llmhub-host`: the LLMHub address
- `YOUR_DEPLOYMENT_ID`: the deployment's ID, which is part of the base URL
- `bge-base-en-v1.5`: the deployment's model name
- `YOUR_LLMHUB_API_KEY`: your API key (see [Authentication](authentication.md))

## Request

=== "curl"

    ```bash
    curl -X POST "https://your-llmhub-host/api/public/v1/deployment/YOUR_DEPLOYMENT_ID/embeddings" \
      -H "Authorization: Bearer YOUR_LLMHUB_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "bge-base-en-v1.5",
        "input": "Hello from LLMHub"
      }'
    ```

=== "Python (OpenAI SDK)"

    ```python
    from openai import OpenAI

    client = OpenAI(
        base_url="https://your-llmhub-host/api/public/v1/deployment/YOUR_DEPLOYMENT_ID",
        api_key="YOUR_LLMHUB_API_KEY",
    )

    response = client.embeddings.create(
        model="bge-base-en-v1.5",
        input="Hello from LLMHub",
    )

    embedding = response.data[0].embedding
    print(len(embedding), embedding[:5])
    ```

=== "JavaScript (OpenAI SDK)"

    ```javascript
    import OpenAI from "openai";

    const client = new OpenAI({
      baseURL:
        "https://your-llmhub-host/api/public/v1/deployment/YOUR_DEPLOYMENT_ID",
      apiKey: "YOUR_LLMHUB_API_KEY",
    });

    const response = await client.embeddings.create({
      model: "bge-base-en-v1.5",
      input: "Hello from LLMHub",
    });

    const embedding = response.data[0].embedding;
    console.log(embedding.length, embedding.slice(0, 5));
    ```

| Field | Type | Description |
|---|---|---|
| `model` | string | The deployment's model name, exactly as shown in the API dialog. |
| `input` | string or list of strings | The text to embed. Send a list to embed several texts in one call. |

The OpenAI SDKs add `/embeddings` to the base URL themselves, so give them the
base URL that ends in the deployment ID.

## Response

```json
{
  "object": "list",
  "data": [
    {
      "object": "embedding",
      "embedding": [0.0132, -0.0237, 0.0418],
      "index": 0
    }
  ],
  "model": "bge-base-en-v1.5",
  "usage": {
    "prompt_tokens": 5,
    "total_tokens": 5
  }
}
```

The vector is shortened here; its real length depends on the model. With a
list as `input`, `data` has one entry per text, in the same order, each with a
matching `index`.

## Errors

The same checks and errors as chat completions apply: see
[Errors](chat-completions.md#errors). An input longer than the model accepts
returns `400` from vLLM, with the reason in the response body.
