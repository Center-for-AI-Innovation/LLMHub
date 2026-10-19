# Launching a model

Open the **Model Library**, find a model, and click **Run Now**. The
**Set Model Lifetime** dialog opens.

## The launch dialog

### Lifetime

**Hours** and **Minutes** set how long the model stays up once it's running.
The default is 30 minutes. Time spent downloading or waiting in the queue
doesn't count.

Pick the shortest lifetime that covers what you need. You're charged for as
long as the model runs, and you can't extend a running deployment, but you
can always launch it again.

### Slurm account

The allocation the GPU time is charged to. The list shows the Slurm accounts
your Delta user belongs to, and LLMHub preselects a GPU account if you have
one. If you work on several projects, check that the right one is selected.

If the dialog says *"No Slurm accounts are associated with your cluster
user"*, you have no allocation LLMHub can charge.

### Hugging Face access token

Shown only for models with a **Gated** chip. Paste a token from an account
that has accepted the model's license. It's used for this launch only and
never stored. See [Gated models](../getting-started/model-library.md#gated-models).

### What you can't change

The partition, GPU type, number of GPUs, and context length are set per
model in the catalog, using settings tested on the cluster. See
[GPUs & cost](gpu-resources.md).

## After you click Launch

If LLMHub can't start the launch, for example because of a bad Hugging Face
token or a lifetime longer than the partition allows, you stay on the library
page and a **Model launch failed** message explains why.

Otherwise LLMHub takes you to **Your Active Models** with the new
deployment's logs open. Its status moves through **Downloading weights**
(first launch on the cluster only), **Pending**, **Launching** and
**Running**. You get an email when it's running, and the **Chat** and **API**
buttons become available.

## Limits

These come from the cluster, not from LLMHub, and can differ between
clusters and partitions:

- **Lifetime.** The partition sets a maximum run time. A request for more is
  refused at launch.
- **How many models at once.** Some partitions allow only one job per person,
  running or queued. On those, a second launch is refused, or waits, until
  the first deployment ends.
- **One copy per model.** Separately, LLMHub never runs two copies of the same
  model for the same person. Launching a model you already have running
  fails with *"This model is already running for this user."*

The LLMHub administrators can tell you the current limits for your cluster.

## Stopping a deployment

On **Your Active Models**, click **Stop** on the card. The model shuts down
right away, without asking for confirmation, and the GPUs are released. Only
the person who launched it can stop it, and stopping it ends it for anyone
it's shared with.

Stopping doesn't send an email. Your chats are kept.

If you don't stop it, it shuts down within a few minutes of its lifetime
running out, and you get an email.
