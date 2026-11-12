# GPUs & cost

Every model in the catalog comes with a fixed launch setup: which GPU
partition it runs on, how many GPUs it uses, and the longest context it
accepts. The administrators choose these settings so the model fits and
starts reliably, and you can't change them in the launch dialog.

## How many GPUs a model uses

The model card shows it two ways:

- the **GPUs** chip, with the number of GPUs per node, and
- the **Small** (1 GPU), **Medium** (2) or **Large** (more than 2) chip.

The biggest models span several nodes and use that many GPUs on *each* one.
Llama 3.2 90B Vision and Mixtral 8x22B run on 2 nodes, and Llama 3.1 405B on
8, so their **GPUs** chip of 4 means 8 and 32 GPUs in all.

In the current catalog, sizes map to GPUs roughly like this:

| Model size | GPUs |
|---|---|
| Up to about 14B parameters | 1 |
| About 26B–34B | 2 |
| About 38B–72B | 4 |
| 90B and larger | 4 per node, on 2 or more nodes |

There are exceptions both ways: mixture-of-experts models like Mixtral 8x7B
need more GPUs than their name suggests, and gpt-oss-120b needs only 2.

A long context window also takes GPU memory, so the same model can need more
GPUs when it's set up for long inputs.

## What you're charged

GPU time is charged to the Slurm account you pick in the launch dialog, at
the cluster's normal rates. You're charged for every GPU in the job, from the
moment it starts running on the cluster until it ends:

> 2 GPUs × 3 hours = 6 GPU-hours
>
> 2 nodes × 4 GPUs × 1 hour = 8 GPU-hours

That includes the few minutes the model takes to load before it's ready.
Downloading weights and waiting in the queue cost nothing.

To keep costs down:

- Pick the smallest model that does the job.
- Ask for a short lifetime, and click **Stop** when you're done.
- Share one deployment with your group instead of everyone launching their
  own. See [Sharing & access](sharing-access.md).

## How a model is split across GPUs

*You don't need this to use LLMHub. It's here in case you're curious.*

Models too big for one GPU are split up by
[vLLM](https://docs.vllm.ai), the server LLMHub runs them with:

- **Tensor parallelism** splits every layer across the GPUs of one node, and
  they all work on each token together. This is how most multi-GPU models in
  the catalog run.
- **Pipeline parallelism** gives each node a slice of the layers, and tokens
  pass from one node to the next. LLMHub uses it only for models too big for
  a single node.

Splitting within one node is faster, so a model only spans nodes when it has
to.
