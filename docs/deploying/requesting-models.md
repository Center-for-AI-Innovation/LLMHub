# Requesting new models

The catalog is curated. Every model in it has launch settings (partition,
GPUs, context length) that the administrators have checked on the cluster.
That's why you can't launch an arbitrary model from Hugging Face yourself.

!!! note "Not ready yet"

    The **Request New Model** button in the Model Library doesn't work yet;
    it only says *Coming soon*. Until it does, use one of the routes below.

## How to ask

Open an issue on
[GitHub](https://github.com/Center-for-AI-Innovation/LLMHub/issues), or
contact the LLMHub administrators, with:

1. **The Hugging Face repository**, for example `Qwen/Qwen3-14B`.
2. **What you need it for**, and why the models already in the catalog don't
   do the job.
3. **How you'll use it:** occasional chat, a class, or something that runs
   for long stretches. This affects what settings make sense.

## What the administrators look at

- **Whether it fits.** The model has to fit on the cluster's GPUs, and very
  large models need several nodes.
- **Whether vLLM can run it.** LLMHub serves models with vLLM, so the model's
  architecture must be one vLLM supports, in the version the cluster uses.
- **The license.** Gated models are fine, but each user then needs to accept
  the license on Hugging Face and supply their own token. See
  [Gated models](../getting-started/model-library.md#gated-models).

Smaller or newer versions of a family already in the catalog are usually the
quickest to add.

Asking for a model doesn't guarantee it will be added, or say when. That's
up to the administrators.
