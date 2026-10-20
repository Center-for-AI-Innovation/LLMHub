# Authentication

The API uses a personal API key. The key acts as you: it can call any
deployment you can use in the web UI, and nothing else.

## Getting a key

You can generate a key in either of two places:

- **Profile** (in the sidebar): click **Generate API Key** in the API Key
  card.
- The **API** dialog on a running deployment's card: click
  **Generate API Key** and confirm.

Copy the key right away. It starts with `llmhub_` and is shown only once.
LLMHub stores only a fingerprint of it, so nobody, including the
administrators, can show it to you again.

!!! warning "One key at a time"

    Each person has one key. Generating a new key immediately replaces the
    old one, and anything still using the old key stops working.

Keys expire **30 days** after they're created. The Profile page shows the
expiry date; generate a new key before then. An expired key is rejected as
invalid.

Treat the key like a password. Don't commit it to a repository or paste it
into a shared notebook. Read it from an environment variable instead:

```bash
export LLMHUB_API_KEY="llmhub_..."
```

## Using the key

Send it as a bearer token in the `Authorization` header:

```text
Authorization: Bearer YOUR_LLMHUB_API_KEY
```

With the OpenAI SDK, pass it as the API key, along with the deployment's base
URL from the API dialog:

=== "Python"

    ```python
    import os
    from openai import OpenAI

    client = OpenAI(
        base_url="https://your-llmhub-host/api/public/v1/deployment/YOUR_DEPLOYMENT_ID",
        api_key=os.environ["LLMHUB_API_KEY"],
    )
    ```

=== "JavaScript"

    ```javascript
    import OpenAI from "openai";

    const client = new OpenAI({
      baseURL: "https://your-llmhub-host/api/public/v1/deployment/YOUR_DEPLOYMENT_ID",
      apiKey: process.env.LLMHUB_API_KEY,
    });
    ```

## What a key can do

**It can** call chat completions on any running deployment you launched or
that someone shared with you.

**It can't** launch, stop or share deployments, read your chats, or do
anything else in LLMHub. Those are web-UI only.

## Authentication errors

| Status | Message | What to do |
|---|---|---|
| `401` | *Unauthorized - API key is required* | Add the `Authorization: Bearer …` header. |
| `401` | *Unauthorized - Invalid API key* | The key is wrong, has expired, or was replaced by a newer one. Generate a new key. |
| `403` | *Unauthorized - You do not have access to this deployment* | The key is fine, but this deployment isn't yours and hasn't been shared with you. |
