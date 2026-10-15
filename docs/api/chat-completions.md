# Chat completions

```text
POST /api/public/v1/deployment/{deploymentId}/chat/completions
```

An OpenAI-compatible chat completions endpoint, proxied by LLMHub to the
deployment's vLLM server. The request body is forwarded as-is, so anything
vLLM's `/v1/chat/completions` supports works here.

The examples use:

- `https://your-llmhub-host` — your LLMHub instance
- `dep_abc123` — the deployment id (from the **API** dialog on a deployment
  card)
- `example-model` — the deployment's model name (also shown in the dialog)

## Request

=== "curl"

    ```bash
    curl -X POST "https://your-llmhub-host/api/public/v1/deployment/dep_abc123/chat/completions" \
      -H "Authorization: Bearer YOUR_LLMHUB_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "example-model",
        "messages": [
          {"role": "system", "content": "You are a helpful assistant."},
          {"role": "user", "content": "Hello from LLMHub"}
        ]
      }'
    ```

=== "Python (OpenAI SDK)"

    ```python
    from openai import OpenAI

    client = OpenAI(
        base_url="https://your-llmhub-host/api/public/v1/deployment/dep_abc123",
        api_key="YOUR_LLMHUB_API_KEY",
    )

    response = client.chat.completions.create(
        model="example-model",
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "Hello from LLMHub"},
        ],
    )

    print(response.choices[0].message.content)
    ```

=== "JavaScript (OpenAI SDK)"

    ```javascript
    import OpenAI from "openai";

    const client = new OpenAI({
      baseURL:
        "https://your-llmhub-host/api/public/v1/deployment/dep_abc123",
      apiKey: "YOUR_LLMHUB_API_KEY",
    });

    const response = await client.chat.completions.create({
      model: "example-model",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello from LLMHub" },
      ],
    });

    console.log(response.choices[0].message.content);
    ```

## Response

A standard OpenAI chat completion:

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1760000000,
  "model": "example-model",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 10,
    "total_tokens": 35
  }
}
```

## Streaming

Set `"stream": true` to receive server-sent events (SSE) as the model
generates:

=== "curl"

    ```bash
    curl -N -X POST "https://your-llmhub-host/api/public/v1/deployment/dep_abc123/chat/completions" \
      -H "Authorization: Bearer YOUR_LLMHUB_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "example-model",
        "messages": [{"role": "user", "content": "Hello from LLMHub"}],
        "stream": true
      }'
    ```

=== "Python (OpenAI SDK)"

    ```python
    stream = client.chat.completions.create(
        model="example-model",
        messages=[{"role": "user", "content": "Hello from LLMHub"}],
        stream=True,
    )

    for chunk in stream:
        content = chunk.choices[0].delta.content
        if content:
            print(content, end="", flush=True)
    ```

=== "JavaScript (OpenAI SDK)"

    ```javascript
    const stream = await client.chat.completions.create({
      model: "example-model",
      messages: [{ role: "user", content: "Hello from LLMHub" }],
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) process.stdout.write(content);
    }
    ```

## Supported parameters

The body is passed through to vLLM, so all standard chat-completions
parameters are available, including `temperature`, `max_tokens`,
`top_p`, `stop`, `n`, and `stream`. The `model` field is required by the
schema but the deployment serves whatever model it runs — use the
deployment's model name shown in the API dialog.

## Errors

| Status | Meaning |
|---|---|
| `401` | Missing or invalid API key. |
| `403` | Your account can't access this deployment (not yours, not shared with you). |
| `404` | No deployment with that id. |
| `503` | Deployment exists but is not `ready`/`running` (still launching, stopped, or failed). |

## Finding the deployment id

On an **Active models** card, click **API**: the dialog lists your running
deployments and generates copy-paste snippets with the real ids and your
host — the snippets in that dialog are always the most accurate for your
instance.
