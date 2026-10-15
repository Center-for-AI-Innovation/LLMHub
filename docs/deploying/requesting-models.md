# Requesting new models

The model library is curated per cluster: every entry carries a launch
configuration — GPU footprint, tensor/pipeline parallelism, context length,
walltime defaults — tuned to that cluster's hardware. That is why you can't
launch an arbitrary Hugging Face repo yourself, and why requesting a model
is the path for something new.

## What to include in a request

Open an issue on
[GitHub](https://github.com/Center-for-AI-Innovation/LLMHub/issues) (or
contact your cluster's administrators) with:

1. **The Hugging Face repo id** — e.g. `Qwen/Qwen3-14B`.
2. **Why you need it** — the task, or what's missing in the current catalog.
3. **Expected usage** — occasional chat, a course with many students, or an
   always-running service. This influences the GPU size and walltime
   defaults.
4. **Your cluster** — Delta, DeltaAI, Magic Castle (Radiant), etc. Catalogs
   differ per infrastructure.

## What happens next

An administrator adds a catalog entry (the repo's
`backend/config/models.yaml`, or the infrastructure-specific
`backend/config/infrastructures/<cluster>/models.yaml`) with tuned launch
settings. Once merged and deployed, the model appears in your cluster's
library.

Things the admin will consider:

- **License & gating** — permissively licensed models are simplest; gated
  models work too, but each user must accept the license on Hugging Face
  and provide their own token (see
  [Gated models](../getting-started/model-library.md#gated-models)).
- **Weights size vs. cluster GPUs** — the model must fit the cluster's GPU
  flavors with some parallelism setting.
- **Vision vs. text** — vision-language models need a vLLM build with the
  right support in the cluster's Apptainer image.

## Fast paths

- **A model that exists on another LLMHub cluster** — say so; porting an
  existing entry to another infrastructure's config is usually quick.
- **A smaller variant of a listed model** — often just a config entry.
