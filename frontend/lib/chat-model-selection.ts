export interface ChatModelSelectionState {
  handledDeploymentId: string | null;
  initialized: boolean;
}

/**
 * Decides which chat model the /chat page should select.
 *
 * `?deployment=<ModelDeployment.id>` selects that deployment's chat option.
 * /api/chat/models already verifies the user can access the deployment, so an
 * unknown or inaccessible id simply falls through to the default. The param is
 * only evaluated against freshly fetched options: a cached list may predate the
 * deployment becoming ready, and checking it would consume the param too early.
 */
export function resolveChatModelSelection({
  chatModelOptions,
  deploymentIdFromUrl,
  isFetchedAfterMount,
  state,
}: {
  chatModelOptions: { id: string }[];
  deploymentIdFromUrl: string | null;
  isFetchedAfterMount: boolean;
  state: ChatModelSelectionState;
}): { modelId: string | null; state: ChatModelSelectionState } {
  if (chatModelOptions.length === 0) {
    return { modelId: null, state };
  }

  let handledDeploymentId = state.handledDeploymentId;
  if (
    deploymentIdFromUrl &&
    isFetchedAfterMount &&
    handledDeploymentId !== deploymentIdFromUrl
  ) {
    handledDeploymentId = deploymentIdFromUrl;
    const requestedModelId = `vllm-deployment:${deploymentIdFromUrl}`;
    if (chatModelOptions.some((chatModel) => chatModel.id === requestedModelId)) {
      return {
        modelId: requestedModelId,
        state: { handledDeploymentId, initialized: true },
      };
    }
  }

  if (state.initialized) {
    return { modelId: null, state: { ...state, handledDeploymentId } };
  }

  // Default to the first option, which is already prioritized by /api/chat/models:
  // most recently updated deployment -> always-on. With an empty list, the
  // selector keeps its initial DEFAULT_CHAT_MODEL.
  return {
    modelId: chatModelOptions[0].id,
    state: { handledDeploymentId, initialized: true },
  };
}
