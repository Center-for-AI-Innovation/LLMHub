# API reference

Every running deployment exposes an **OpenAI-compatible chat completions
endpoint** through LLMHub's public API. If your code already talks to
OpenAI, migrating is usually just a base-URL and key change.

```text
POST {llmhub-host}/api/public/v1/deployment/{deploymentId}/chat/completions
Authorization: Bearer {llmhub_api_key}
```

## What you need

1. **A running deployment** you own or that was shared with you — its id is
   in the API dialog on the deployment card.
2. **An LLMHub API key** — generate one from your profile. See
   [Authentication](authentication.md).

## Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/public/v1/deployment/{id}/chat/completions` | Chat completions (the only public endpoint today). |

The request and response bodies follow the OpenAI chat completions schema:
a `messages` array, standard sampling parameters, and optional `stream: true`
for server-sent events.

## Security model

Every call is checked server-side before it reaches the model:

1. The `Authorization: Bearer` key must belong to a valid LLMHub user.
2. That user must own the deployment or have it shared with them.
3. The deployment must be `ready` or `running`.

Violations return `401` (bad key), `403` (no access to this deployment),
`404` (no such deployment), or `503` (deployment not ready).

## In this section

- [Authentication](authentication.md) — creating and using API keys
- [Chat completions](chat-completions.md) — full request/response examples
  in curl, Python, and JavaScript
