# Authentication

The public API uses **personal API keys**. A key identifies you — the same
user as your LLMHub sign-in — and gives API access to exactly the
deployments you can already see in the UI.

## Generating a key

1. Sign in to LLMHub.
2. Open your **profile** (avatar menu → profile).
3. In the **API key** panel, click **Generate API key**.
4. Copy the key immediately — LLMHub shows it only once.

If you regenerate, the old key is replaced.

!!! warning
    Treat the key like a password. It grants API access to all your
    deployments until it expires or is regenerated.

## Using the key

Send it as a bearer token on every request:

```text
Authorization: Bearer {llmhub_api_key}
```

For example:

```bash
curl -X POST "https://your-llmhub-host/api/public/v1/deployment/dep_abc123/chat/completions" \
  -H "Authorization: Bearer YOUR_LLMHUB_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "example-model", "messages": [{"role": "user", "content": "Hello!"}]}'
```

With the OpenAI SDKs, pass the key as `api_key` and the deployment URL as
`base_url`:

=== "Python"

    ```python
    from openai import OpenAI

    client = OpenAI(
        base_url="https://your-llmhub-host/api/public/v1/deployment/dep_abc123",
        api_key="YOUR_LLMHUB_API_KEY",
    )
    ```

=== "JavaScript"

    ```javascript
    import OpenAI from "openai";

    const client = new OpenAI({
      baseURL: "https://your-llmhub-host/api/public/v1/deployment/dep_abc123",
      apiKey: "YOUR_LLMHUB_API_KEY",
    });
    ```

## What the key can and cannot do

**Can**: call chat completions on any deployment you own or that has been
shared with you.

**Cannot**: launch or stop deployments, read chats, manage sharing, or
access anything outside the public API. Administrative actions are UI-only.

## Errors

| Status | Meaning |
|---|---|
| `401 Unauthorized - API key is required` | No `Authorization` header. |
| `401 Unauthorized - Invalid API key` | Wrong, expired, or regenerated key. |
| `403` | The key is valid, but its user can't access this deployment. |
