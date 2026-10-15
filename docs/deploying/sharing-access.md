# Sharing & access

A model deployment is visible and usable only by its owner — unless you
share it. Sharing lets teammates chat with **your** deployment (and call it
via the API) without launching — and paying for — their own copy.

## Sharing a deployment

1. On the deployment card, click **Share**.
2. Enter the email address(es) of the users you want to invite.
3. Send the invites.

Users see pending invites and, once accepted, the shared deployment appears
in their model picker alongside their own.

## Permissions

There are two permission levels:

| Permission | Can do |
|---|---|
| **Owner** | Everything: chat, API, logs, share, stop the deployment. |
| **User** | Chat and call the API; view status. Cannot stop, re-share, or manage the deployment. |

The launcher is always the owner. You can grant the owner permission to
another user (e.g. a group lead).

## What sharing does *not* do

- Sharing does **not** share your chats — each user gets their own
  conversations with the model.
- Sharing does **not** share your API key — each user generates their own
  (see [Authentication](../api/authentication.md)).
- Stopping the deployment ends it for everyone sharing it.

## Access checks

Access is enforced server-side on every call: the chat proxy and the public
API both verify that the requesting user owns the deployment or has been
granted access before forwarding anything to vLLM.

## Typical pattern for a research group

The group lead (or whoever holds the GPU allocation) launches the model once
under the group account and shares it with the group's members. Everyone
chats with the single deployment, and the GPU cost stays on one allocation.
