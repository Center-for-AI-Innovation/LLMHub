# Sharing & access

A deployment is private to the person who launched it until they share it.
Sharing lets colleagues chat with your model and call it through the API,
without launching (and paying for) their own copy.

## Sharing a deployment

1. On **Your Active Models**, click **Share** on the card. Only the person
   who launched the deployment sees this button.
2. Type at least two letters of a colleague's name or email, and pick them
   from the results. You can add several people.
3. Click **Share access**.

You can only find people who have already signed in to LLMHub at least once.
If a colleague isn't in the results, ask them to sign in first.

The dialog lists everyone with access under **People with access**, marked
**Owner** or **Member**.

## What the people you share with get

- An email saying they've been given access.
- The deployment on their **Your Active Models** page and in their chat
  model picker.
- The **Chat**, **API** and **Logs** buttons. They can't stop or re-share
  it.

Each person has their own chats with the model. Sharing a deployment doesn't
share anyone's conversations, and each person calls the API with their own
key.

## Things to know

- **There's no way to remove someone's access yet.** Access ends when the
  deployment does. Only share with people you're happy to give access for
  its whole lifetime.
- **It's your job on your allocation.** You pay for the GPU time whether one
  person uses the model or twenty, and the people you share with pay
  nothing.
- **Stopping the deployment ends it for everyone.** People you've shared
  with don't get an email when you stop it.

## A pattern for research groups

One person, usually whoever holds the allocation, launches the model and
shares it with the group. Everyone chats with that one deployment, and the
GPU time is charged once.

## Sharing a conversation instead

To show someone a conversation rather than give them the model, make the chat
public from the sidebar. See [Chat history](../getting-started/using-chat.md#chat-history).
