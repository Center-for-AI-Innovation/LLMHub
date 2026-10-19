/**
 * Picks the chat model the /chat page should select.
 *
 * `?deployment=<ModelDeployment.id>` selects that deployment's chat option.
 * /api/chat/models only returns deployments the user can access, so an unknown
 * or inaccessible id falls back to the first option and is reported as
 * unavailable. Options are already prioritized by /api/chat/models: most
 * recently updated deployment -> always-on. An empty list leaves nothing to
 * select or fall back to; the caller must not resolve with a stale selection.
 */
export function pickChatModel(
  chatModelOptions: { id: string }[],
  deploymentIdFromUrl: string | null,
): { modelId: string | null; deploymentUnavailable: boolean } {
  const defaultModelId = chatModelOptions[0]?.id ?? null;

  if (!deploymentIdFromUrl) {
    return { modelId: defaultModelId, deploymentUnavailable: false };
  }

  const requestedModelId = `vllm-deployment:${deploymentIdFromUrl}`;
  if (chatModelOptions.some((chatModel) => chatModel.id === requestedModelId)) {
    return { modelId: requestedModelId, deploymentUnavailable: false };
  }

  return { modelId: defaultModelId, deploymentUnavailable: true };
}
