# GPU resources & parallelism

Models are served by [vLLM](https://docs.vllm.ai), and vLLM can split a
model across multiple GPUs in two ways. LLMHub's model catalog carries the
right setting for each model, so most users never need to think about this —
but it helps to understand what the launch dialog is asking when it is.

## How models are split across GPUs

**Tensor parallelism (TP)** splits each layer of the model across GPUs in
the same node. All GPUs work on every token. This is what "GPUs per node"
means in a launch config, and it is what the `--tensor-parallel-size` flag
configures on the vLLM server.

**Pipeline parallelism (PP)** splits the model's layers into stages, one
stage per node. Tokens flow through the stages like an assembly line. This
is what "nodes" means, configured as `--pipeline-parallel-size`.

```text
Tensor parallel (2 GPUs, 1 node)      Pipeline parallel (2 nodes, 1 GPU each)

 ┌───────── node ─────────┐            ┌── node 1 ──┐   ┌── node 2 ──┐
 │  GPU 0   │   GPU 1     │            │  layers    │ → │  layers    │
 │  ┌────┬──┼──┬────┐     │            │  1 … n/2   │   │  n/2 … n   │
 │  │  each token  │      │            │   GPU 0    │   │   GPU 0    │
 │  └────┴──┼──┴────┘     │            └────────────┘   └────────────┘
 └────────────────────────┘
```

A model's catalog entry pins `gpus_per_node` (tensor parallelism) and
`num_nodes` (pipeline parallelism). An explicit GPU/node request sets
`--tensor-parallel-size` / `--pipeline-parallel-size` on the vLLM server,
which multi-GPU launches require.

## Rules of thumb

- **A model's config is curated** — the GPUs and parallelism it lists are
  what fits the model's weights and expected traffic on that cluster's
  hardware. Deviate only on the advice of the cluster admin.
- **Bigger models need more GPUs.** Roughly: 7–8B parameters fit on one
  modern 80 GB GPU; 30–70B models want 2–4 GPUs; larger or long-context
  models want more.
- **Tensor parallelism within a node is faster than pipeline parallelism
  across nodes** for the same GPU count — use TP when the node has enough
  GPUs, PP when the model must span nodes.
- **GPU type matters.** Configs are per-infrastructure: the same model may
  have a different footprint on an A100 cluster than on an L40S cluster.

## Multi-node requirements

Pipeline-parallel launches span multiple nodes, so the cluster needs a fast
interconnect (InfiniBand or similar) and the vLLM container image must
support multi-node launch. On NCSA's Magic Castle (Radiant) deployment, for
example, larger models run with pipeline parallelism = 2 across the two
single-GPU nodes.

## Charging

GPU-hours are charged to the Slurm account you pick at launch, for the whole
job: a 2-GPU deployment running for 2 hours costs 4 GPU-hours.
