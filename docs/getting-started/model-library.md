# Model library

The model library is the catalog of models available on your cluster. After
signing in you land here; it is also reachable from the sidebar.

## Reading a model card

Each card shows:

- **Model name and family** — e.g. Qwen3, Llama, Mistral, DeepSeek-R1
  distills.
- **Type** — text-only (`LLM`) or vision-language (`VLM`) model.
- **Size / variant** — parameter count and variant, e.g. `14B`.
- **Specs** — GPU footprint, context length, and other launch defaults.
- **Gated badge** — the model's weights are gated on Hugging Face; see below.

## Launching

Click **Launch** on a card to open the launch dialog. Head to
[Launching a model](../deploying/launching.md) for the details of each
setting.

## Gated models

Some models (for example certain Qwen and Llama releases) require you to
accept a license on Hugging Face before the weights can be downloaded. Cards
for these models show a **Gated** badge.

To launch a gated model:

1. On [huggingface.co](https://huggingface.co), sign in and accept the
   model's license terms.
2. In LLMHub, launch the model and provide your Hugging Face access token
   when prompted.

Your token is used only to verify your access to that model and to download
the weights. It is never stored, written into job files, or visible to other
users.

## Requesting a model that isn't listed

The catalog is curated per cluster — models are added with tuned launch
configs (GPUs, parallelism, context length). If you need something that
isn't there, see [Requesting new models](../deploying/requesting-models.md).

## Model cards vs. active models

The library shows everything *available to launch*. Once launched, your
models move to **Active models**, where you can chat, check logs, share, and
stop them. A model stays in the library even while you have it running.
