# Using chat

The chat page is where you talk to running models. Open it with **New Chat**
in the sidebar, or with the **Chat** button on a running model in **Your
Active Models**.

## Choosing a model

The model picker sits next to the send button. It lists the running
deployments you can use, your own and any shared with you, most recently
updated first.

Some LLMHub sites also run an **always-on model**, listed last, that you can
chat with without launching anything. LLMHub on Delta doesn't have one yet.

Only models that are running appear. If a deployment is still downloading,
queued or starting, launch it and wait for **Running** first.

The **Chat** button on a deployment card opens the chat with that deployment
already selected. If it has stopped, or you no longer have access, the chat
falls back to the first model in the list and tells you so.

!!! note "On a phone"

    The model picker is hidden on narrow screens. Open chat from a
    deployment's **Chat** button to pick a model.

If no models are available at all, the message box says **No models
available**. Launch a model from the [Model library](model-library.md).

### When a model stops mid-chat

The picker doesn't notice a deployment stopping until you reload or come back
to the tab. If you send a message to a stopped deployment, you get an error
such as *"Deployment is not ready"* or *"Selected model is unavailable"*. Pick
another model, or launch the deployment again.

## Sending messages

- Press ++enter++ to send and ++shift+enter++ for a new line.
- Responses stream in as the model writes them. Click the stop button to cut
  one short.
- The first reply after a model starts can be slow while it warms up. Later
  replies are faster.

## Message actions

- **Copy**, **thumbs up** and **thumbs down** appear under the model's
  replies.
- **Edit** (the pencil that appears when you hover over one of your messages)
  lets you rewrite it. When you send the edited message, everything after it
  in the chat is deleted and the model answers again.

There's no regenerate button. To get a different answer, edit your message
and send it again.

## Reasoning

Reasoning models, such as the DeepSeek-R1 distills and Qwen3, think before
they answer. Their thinking appears in a collapsible **Thinking…** block above
the answer, which shows how long the model thought and collapses when the
reply is done.

## Images

Click the paperclip to attach an image (JPEG or PNG, up to 5 MB). Only
vision models can read images: LLaVA, Llama 3.2 Vision, Pixtral, InternVL,
Phi-3.5 Vision, DeepSeek-VL2, GLM-4V, Molmo and MedGemma in the current
catalog. Other models ignore images or return an error. Images in older
chats may stop displaying after a while.

## Chat history

Signed-in users' chats are saved automatically and listed in the sidebar by
date. A chat's title is the start of its first message; you can't rename it.

Each chat's **⋯** menu has:

- **Share → Private / Public**: chats start private. A **public** chat can be
  read, but not continued, by **anyone with its link, including people who
  aren't signed in**. Don't make a chat public if it contains anything you
  wouldn't post openly.
- **Delete**: removes the chat for good, after asking you to confirm.

To let someone chat with *your model* rather than read your conversation,
share the deployment instead. See
[Sharing & access](../deploying/sharing-access.md).

## Guest chat

On sites with an always-on model, visitors who haven't signed in can send it
5 messages. Guest chats aren't saved and can't use attachments. LLMHub on
Delta has no always-on model, so there you need to sign in to chat.

## Not ready yet

The chat page still carries some features from the template LLMHub was built
on: the suggested prompts on an empty chat (such as the weather in San
Francisco), document and code *artifacts*, and the weather tool. They don't
work with LLMHub's models yet, so the model may mention them or the prompts
may not do what they suggest.
