# Quickstart

This guide takes you from signing in to chatting with a model you launched
yourself, and then shutting it down. It takes about ten minutes, most of it
waiting for the cluster.

You need a Delta account, a GPU allocation, and an account enabled for
LLMHub. LLMHub runs your model as a Slurm job on Delta and charges the GPU
time to one of your allocations.

## 1. Sign in

1. Open LLMHub and click **Login**.
2. Sign in through CILogon with your University of Illinois account.
3. You land on the **Model Library**, the catalog of models you can launch.

If sign-in fails with *"Your identity is not authorized to use LLM Hub on
this cluster"*, your account isn't enabled for LLMHub yet. Contact the LLMHub
administrators.

## 2. Launch a model

1. In the **Model Library**, find a model. For a first try, pick a small one:
   cards marked **Small** need a single GPU and start fastest.
2. Click **Run Now** on its card.
3. In the **Set Model Lifetime** dialog:

    - **Hours / Minutes**: how long the model should stay up once it's
      running. The default is 30 minutes and the maximum is 23 h 59 min.
      Time spent waiting in the queue doesn't count.
    - **Slurm account**: the allocation the GPU time is charged to. LLMHub
      picks a GPU account for you if you have one; change it if you have
      several.
    - **Hugging Face access token**: shown only for models marked **Gated**.
      See [Gated models](model-library.md#gated-models).

4. Click **Launch**. LLMHub takes you to **Your Active Models** and opens the
   deployment's logs.

The card's status shows how far along it is:

| Status | Meaning |
|---|---|
| **Downloading weights** | First launch of this model on the cluster. LLMHub is downloading it, and submits the job when the download finishes. |
| **Pending** | The Slurm job is waiting in the queue for a GPU. |
| **Launching** | The job is running and the model server is starting up. This usually takes a few minutes. |
| **Running** | The model is ready. |
| **Failed** | Something went wrong. The logs and the failure email say why. |

You get an email when the model is ready, and another if it fails.

## 3. Chat with it

1. When the card says **Running**, click **Chat**.
2. Type a message and press ++enter++.

The chat opens with your deployment already selected. See
[Using chat](using-chat.md) for everything else the chat page does.

## 4. Stop it when you're done

GPUs are shared, and your allocation is charged for as long as the job runs.
When you're finished, go to **Your Active Models** and click **Stop** on the
card. It stops right away, with no confirmation.

If you forget, the deployment shuts down by itself when its lifetime runs
out, and you get an email saying it has completed. There's no way to extend a
running deployment; launch it again if you need more time.

## Next steps

- [Using chat](using-chat.md): attachments, editing messages, sharing chats
- [Model library](model-library.md): what the cards tell you, and gated
  models
- [Sharing & access](../deploying/sharing-access.md): let teammates use your
  deployment
- [API reference](../api/index.md): call your deployment from code
- [FAQs](faqs.md): common problems and what to do about them
