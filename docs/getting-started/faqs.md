# FAQs

## General

**What is LLMHub?**

A web app for running open language models on NCSA's Delta supercomputer.
You pick a model, LLMHub runs it as a GPU job on the cluster, and you chat
with it in the browser or call it from your own code through an
OpenAI-compatible API.

**Who can use it?**

Anyone at the University of Illinois with a Delta account and a GPU
allocation to charge.

**What does it cost?**

LLMHub itself is free. The GPU time your models use is charged to the Slurm
allocation you pick at launch, for as long as the model runs. Stop models
when you're done.

**Is my data private?**

Your chats are private unless you make one public, and public chats can be
read by anyone with the link. The models run on NCSA hardware, and nothing is
sent to outside AI providers. Follow your project's rules on sensitive data
all the same: don't paste in passwords, protected health information or
anything else you're not allowed to process on Delta.

## Signing in

**"Your identity is not authorized to use LLM Hub on this cluster."**

Your account isn't enabled for LLMHub. Contact the LLMHub administrators.

## Launching models

**I can't find a model I just used.**

Models you have running, or that are still starting, are hidden from the
Model Library. Look in **Your Active Models**.

**"This model is already running for this user."**

You can run one copy of each model at a time. Use the one you have, or stop
it and launch again.

**"No Slurm accounts are associated with your cluster user."**

You don't have an allocation LLMHub can charge on this cluster. Ask your
project's PI to add you to one, or request one through ACCESS.

**The launch failed with a message about Hugging Face access.**

The model is gated. Accept its license on huggingface.co and paste a valid
token when you launch. See [Gated models](model-library.md#gated-models).

**My model has said "Downloading weights" for a long time.**

It's the first launch of that model on the cluster, so LLMHub is downloading
it. The largest models can take tens of minutes. Once it's downloaded, every later
launch (yours or anyone's) skips this step. Stopping the deployment while it
downloads cancels the launch.

**My model has said "Pending" for a long time.**

The job is waiting in the Slurm queue for a free GPU. How long depends on how
busy the cluster is. The lifetime you picked doesn't start counting until the
model is running.

**My model failed while launching.**

Open **Logs** on its card. The cause is usually in the last few lines of the
*stderr* tab, and the failure email repeats it. Common ones:

- *CUDA out of memory* or *KV cache … is larger than the available memory*:
  the model doesn't fit on the GPUs it was given. Tell the administrators,
  since launch settings are set per model.
- *401* or *403* from huggingface.co: a gated model, with a missing or invalid
  token.

**Can I run several models at once?**

Yes. Each one is a separate job, charged separately. You just can't run two
copies of the same model.

**Can I give my model more time?**

Not while it's running. When it shuts down, launch it again with a longer
lifetime (up to 23 h 59 min).

**What happens when the lifetime runs out?**

The model shuts down within a few minutes and you get an email. Your chats
are kept.

## Chat

**The model picker says "No models available".**

Nothing is running that you can use. Launch a model from the
[Model library](model-library.md), and wait until its card says **Running**.

**I get "Deployment is not ready" or "Selected model is unavailable".**

The model you picked has stopped. Reload the page and choose another one.

**The model ignored my image.**

Only vision models can read images. See
[Images](using-chat.md#images).

**A base model gives strange answers in chat.**

Base models aren't trained to chat, and some have no chat template. Use the
*Instruct* version. See
[Base and instruct models](model-library.md#base-and-instruct-models).

**Can I share a chat?**

Yes, as a read-only link: open the chat's **⋯** menu in the sidebar and
choose **Share → Public**. Anyone with the link can read it, even without
signing in. To let someone talk to your model, share the deployment instead
(see [Sharing & access](../deploying/sharing-access.md)).

## API

**How do I call my model from code?**

Click **API** on a running model's card. The dialog gives you an API key, the
base URL and ready-to-run curl, Python and JavaScript examples. See the
[API reference](../api/index.md).

**Is it compatible with the OpenAI SDK?**

Yes, for chat completions. Point the SDK at the deployment's base URL and use
your LLMHub API key.

## Getting help

- For a failing model, check its **Logs** first.
- For account, allocation or access problems, contact the LLMHub
  administrators.
- To report a bug or ask for a feature, open an issue on
  [GitHub](https://github.com/Center-for-AI-Innovation/LLMHub/issues).
