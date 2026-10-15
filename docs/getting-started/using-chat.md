# Using chat

The chat page is where you interact with running deployments. This page
covers the features of the chat interface.

## Choosing a model

The model picker in the composer (bottom right) lists everything you can
currently chat with:

- **Your active deployments** — models you launched, most recent first.
- **Deployments shared with you** — models teammates shared with you (see
  [Sharing & access](../deploying/sharing-access.md)).
- **The always-on model** — a smaller model that is always available, useful
  for quick questions while your deployments start.

The picker is disabled for a moment when the page loads while LLMHub checks
which models are actually available to you — this prevents sending a message
to a deployment that just stopped.

## Sending messages

- Type in the composer and press ++enter++ to send; ++shift+enter++ inserts a
  newline.
- Click :material-stop-circle-outline: to stop a response mid-stream.
- The chat streams tokens as the model generates them.

## Attachments

Click the :material-paperclip: icon to attach files to a message. Attachments
are uploaded, stored, and passed to the model with your prompt — useful for
code, data, and documents you want the model to read.

## Artifacts

Long code, documents, and other generated content are rendered as
**artifacts** beside the conversation rather than as raw markdown in the chat
stream. Artifacts have their own panel where you can read, copy, and download
the content.

## Chat history

- Chats are saved automatically and listed in the sidebar.
- Click **New chat** to start over.
- Each chat keeps the model it was started with; opening it later continues
  with that model's deployment (or tells you if it has stopped).

## Guest mode

If you use LLMHub without signing in, you chat with the always-on model only,
with a limited number of messages. Sign in to launch your own models and get
unlimited chats with them.

## Tips

- **Warm-up**: the first message after a deployment becomes ready can take
  noticeably longer — vLLM is still warming up. Subsequent messages are
  faster.
- **Context**: models have a finite context window. Very long conversations
  may degrade; start a new chat when you change topics.
- **Switching models**: switch models between chats with the picker, but a
  single chat's history stays bound to the model that produced it.
