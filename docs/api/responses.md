# Responses

```text
POST /api/public/v1/deployment/{deploymentId}/responses
```

An OpenAI-compatible
[Responses API](https://platform.openai.com/docs/api-reference/responses)
endpoint for chat models. LLMHub checks your key and access, then passes the
request unchanged to the deployment's [vLLM](https://docs.vllm.ai) server.
It answers the same models as [chat completions](chat-completions.md), so use
whichever API your code or framework expects.

LLMHub's Responses API is **stateless**: the server doesn't keep responses
after it sends them. To continue a conversation, send it again (see
[Conversations](#conversations)), and see [What's not supported](#whats-not-supported)
for the features that need stored responses.

The examples use placeholders. Replace them with the values from the
deployment's **API** dialog. The dialog's examples are for chat completions,
but the base URL and model name are the same:

- `https://your-llmhub-host`: the LLMHub address
- `YOUR_DEPLOYMENT_ID`: the deployment's ID, which is part of the base URL
- `Qwen2.5-7B-Instruct`: the deployment's model name
- `YOUR_LLMHUB_API_KEY`: your API key (see [Authentication](authentication.md))

## Request

=== "curl"

    ```bash
    curl -X POST "https://your-llmhub-host/api/public/v1/deployment/YOUR_DEPLOYMENT_ID/responses" \
      -H "Authorization: Bearer YOUR_LLMHUB_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "Qwen2.5-7B-Instruct",
        "instructions": "You are a helpful assistant.",
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

    response = client.responses.create(
        model="Qwen2.5-7B-Instruct",
        instructions="You are a helpful assistant.",
        input="Hello from LLMHub",
    )

    print(response.output_text)
    ```

=== "JavaScript (OpenAI SDK)"

    ```javascript
    import OpenAI from "openai";

    const client = new OpenAI({
      baseURL:
        "https://your-llmhub-host/api/public/v1/deployment/YOUR_DEPLOYMENT_ID",
      apiKey: "YOUR_LLMHUB_API_KEY",
    });

    const response = await client.responses.create({
      model: "Qwen2.5-7B-Instruct",
      instructions: "You are a helpful assistant.",
      input: "Hello from LLMHub",
    });

    console.log(response.output_text);
    ```

| Field | Type | Description |
|---|---|---|
| `model` | string | The deployment's model name, exactly as shown in the API dialog. |
| `input` | string or list of messages | The prompt, or a conversation as a list of `{"role": ..., "content": ...}` messages. |
| `instructions` | string | Optional. A system prompt for this request. |

The OpenAI SDKs add `/responses` to the base URL themselves, so give them the
base URL that ends in the deployment ID.

## Response

```json
{
  "id": "resp_8f3c2a1b",
  "object": "response",
  "created_at": 1760000000,
  "model": "Qwen2.5-7B-Instruct",
  "status": "completed",
  "output": [
    {
      "type": "message",
      "id": "msg_4d2e9f10",
      "role": "assistant",
      "status": "completed",
      "content": [
        {
          "type": "output_text",
          "text": "Hello! How can I assist you today?",
          "annotations": []
        }
      ]
    }
  ],
  "usage": {
    "input_tokens": 24,
    "output_tokens": 10,
    "total_tokens": 34
  }
}
```

The reply text is in `output[].content[].text`. The OpenAI SDKs also join it
for you as `response.output_text`.

## Streaming

Set `"stream": true` to receive server-sent events (SSE) as the model
generates. The text arrives in `response.output_text.delta` events, and the
stream ends with `response.completed`:

=== "curl"

    ```bash
    curl -N -X POST "https://your-llmhub-host/api/public/v1/deployment/YOUR_DEPLOYMENT_ID/responses" \
      -H "Authorization: Bearer YOUR_LLMHUB_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "Qwen2.5-7B-Instruct",
        "input": "Hello from LLMHub",
        "stream": true
      }'
    ```

=== "Python (OpenAI SDK)"

    ```python
    stream = client.responses.create(
        model="Qwen2.5-7B-Instruct",
        input="Hello from LLMHub",
        stream=True,
    )

    for event in stream:
        if event.type == "response.output_text.delta":
            print(event.delta, end="", flush=True)
    ```

=== "JavaScript (OpenAI SDK)"

    ```javascript
    const stream = await client.responses.create({
      model: "Qwen2.5-7B-Instruct",
      input: "Hello from LLMHub",
      stream: true,
    });

    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        process.stdout.write(event.delta);
      }
    }
    ```

## Conversations

Because responses aren't stored, each request must carry the whole
conversation. Send `input` as a list of messages, adding the model's last
reply and your next message each turn:

```python
conversation = [{"role": "user", "content": "My name is Ada."}]

first = client.responses.create(model="Qwen2.5-7B-Instruct", input=conversation)

conversation += [
    {"role": "assistant", "content": first.output_text},
    {"role": "user", "content": "What's my name?"},
]

second = client.responses.create(model="Qwen2.5-7B-Instruct", input=conversation)
print(second.output_text)  # "Your name is Ada."
```

## Parameters

The request goes to vLLM unchanged, so the Responses API parameters vLLM
supports work here, including `temperature`, `top_p`, `max_output_tokens`,
structured output with `text.format`, and function tools that your own code
runs. Function tools need the same tool-calling support on the model as they
do with chat completions.

`model` must be the deployment's model name exactly, and long inputs count
against the model's context length, just as with chat completions.

## What's not supported

These features need the server to store responses, which LLMHub doesn't
enable:

- **`previous_response_id`**: continuing from an earlier response by its ID.
  It fails with `404` ("Response with id … not found"). Send the
  conversation again instead.
- **`background: true`**: running a request in the background. vLLM
  rejects it with an error.
- **Fetching or cancelling a response** with `GET /responses/{id}` or
  `POST /responses/{id}/cancel`: these routes don't exist in LLMHub.
- **`store: true`** is accepted but has no effect.

Built-in tools, such as web search, code interpreter and MCP, aren't
available either.

## Errors

The same checks and errors as chat completions apply: see
[Errors](chat-completions.md#errors). The `404` for `previous_response_id`
comes from vLLM, so its `error.type` isn't `proxy_error`.
