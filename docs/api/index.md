# API reference

Every running deployment has an OpenAI-compatible **chat completions**
endpoint, so you can use your models from scripts, notebooks and
applications. Code written for the OpenAI SDK usually needs only a new base
URL, API key and model name.

```text
POST https://your-llmhub-host/api/public/v1/deployment/{deploymentId}/chat/completions
Authorization: Bearer YOUR_LLMHUB_API_KEY
```

## What you need

1. **A running deployment**, either yours or one shared with you.
2. **An LLMHub API key.** See [Authentication](authentication.md).
3. **The deployment's base URL and model name.** Click **API** on the
   deployment's card in **Your Active Models**. The dialog shows both, with
   ready-to-run examples in curl, Python and JavaScript.

## Things to know

- **Each deployment has its own URL.** The deployment ID is part of the base
  URL, and every launch gets a new ID. When you relaunch a model, update the
  URL in your code.
- **Your code stops working when the deployment ends.** Calls to a stopped
  deployment fail with `503`. The API can't launch or restart models; do that
  in the web UI.
- **Only chat completions is available.** There's no `/models`, `/completions`
  or `/embeddings` endpoint.
- **The model name must match exactly.** Use the name shown in the API
  dialog, which is the model's catalog name, such as `Qwen2.5-7B-Instruct`.

## How access is checked

Every call is checked before it reaches the model:

1. The API key must belong to an LLMHub user and must not have expired.
2. That user must have launched the deployment or been given access to it.
3. The deployment must be running.

See [Errors](chat-completions.md#errors) for what each failure returns.

## In this section

- [Authentication](authentication.md): creating, using and replacing API keys
- [Chat completions](chat-completions.md): requests, streaming, parameters
  and errors
