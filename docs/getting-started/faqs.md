# FAQs

## General

**What is LLMHub?**

A web platform for running open source language models on supercomputing
clusters. You pick a model, LLMHub launches it as a cluster job running
vLLM, and you chat with it in the browser or call it from your code through
an OpenAI-compatible API.

**Who can use it?**

The University of Illinois community, using institutional sign-in via
CILogon. Availability of specific clusters and models depends on your
allocations.

**Is my data private?**

Chats are private to your account by default. Model deployments run under
your cluster account. Don't paste sensitive data (credentials, personal
information, protected research data) into any shared or always-on model.

## Launching and deployments

**Why is my deployment stuck in "Downloading weights"?**

The first launch of a model downloads its weights to the cluster's shared
cache. Large models can take several minutes. Subsequent launches of the
same model start much faster because the weights are cached. You can watch
progress from the deployment card; stopping the deployment while it
downloads cancels the launch.

**What happens when the walltime expires?**

The deployment shuts down automatically. Nothing is deleted — your chats and
artifacts remain — but you'll need to launch the model again to keep using
it.

**Can I run several models at once?**

Yes, as long as you have GPUs available and your account's limits allow it.
Each deployment is a separate Slurm job.

**My launch failed with a message about Hugging Face access.**

The model is gated: accept its license on huggingface.co and provide your
Hugging Face token when launching. See [Gated models](model-library.md#gated-models).

**My launch failed with "Cluster username is required" (or a similar
account error).**

Launches are charged to a Slurm account. Make sure you picked an account in
the launch dialog; if none is listed, you may not have an allocation on that
cluster — contact your group lead or the administrators.

## Chat

**The first response is slow. Is that normal?**

Yes — vLLM warms up on the first request after a deployment becomes ready.
Later messages are faster.

**The model picker says "No models available".**

You have no running deployments, none shared with you, and the cluster has no
always-on model configured. Launch a model from the library.

**Can I share a chat with someone?**

Chats are private to your account. Share the *deployment* instead (see
[Sharing & access](../deploying/sharing-access.md)) and let the other person
chat with the model themselves.

## API

**How do I call my deployment from code?**

Generate an API key in your profile, then POST to the deployment's chat
completions endpoint. See the [API reference](../api/index.md) for
copy-paste curl, Python, and JavaScript examples.

**Is the API OpenAI-compatible?**

Yes — the chat completions endpoint accepts OpenAI-style request bodies
(messages, temperature, max tokens, streaming). Most OpenAI clients work if
you point them at the LLMHub base URL and use your LLMHub API key.

## Getting help

- Check the [logs](../deploying/logs-monitoring.md) for a failing deployment
  — the error is usually in the last lines.
- For account, access, or cluster issues, contact the LLMHub administrators
  for your institution.
- Found a bug or want a feature? Open an issue on
  [GitHub](https://github.com/Center-for-AI-Innovation/LLMHub/issues).
