'use client';

import type { ChatRequestOptions, UIMessage } from 'ai';
import { DefaultChatTransport } from 'ai';
import { useChat } from '@ai-sdk/react';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { useQueryClient } from '@tanstack/react-query';

import type { Vote, Document } from '@/lib/db/schema';
import { fetcher, generateUUID } from '@/lib/utils';
import type { UploadedAttachment } from '@/lib/chat-attachments';

import { Artifact, artifactDefinitions, type ArtifactKind } from './artifact';
import { MultimodalInput } from './multimodal-input';
import { Messages } from './messages';
import type { VisibilityType } from './visibility-selector';
import { useArtifact, useArtifactSelector, initialArtifactData } from '@/hooks/use-artifact';
import { toast } from '@/components/ui/use-toast';
import {
  isGuestLimitErrorMessage,
  normalizeChatRequestError,
} from '@/lib/chat-client-errors';
import {
  GUEST_CHAT_MAX_MESSAGES,
  getGuestMessageCount,
} from '@/lib/guest-chat';
import { useModelSelector } from '@/hooks/use-model-selector';
import { useDocumentCache } from '@/hooks/use-document-cache';
import { useVllmJob, getVllmChatEndpoint } from '@/hooks/use-vllm-job';
import { useNewChat } from '@/hooks/use-new-chat';
import { usePendingChat } from '@/hooks/use-pending-chat';
import type { DataStreamDelta } from '@/lib/ai/data-stream';

const VLLM_DEPLOYMENT_PREFIX = 'vllm-deployment:';

function getSelectedVllmDeploymentId(model: string): string | null {
  if (!model.startsWith(VLLM_DEPLOYMENT_PREFIX)) {
    return null;
  }

  const deploymentId = model.slice(VLLM_DEPLOYMENT_PREFIX.length).trim();
  return deploymentId.length > 0 ? deploymentId : null;
}

function isVllmDeploymentModel(model: string): boolean {
  return model === 'vllm-model' || model.startsWith(VLLM_DEPLOYMENT_PREFIX);
}

// Helper to determine API endpoint based on model and deployment ID
const getApiEndpoint = (model: string, vllmDeploymentId: string | null) => {
  if (model === 'guest-vllm-model' || model === 'always-on-model') {
    return '/api/public/chat';
  }

  const selectedDeploymentId = getSelectedVllmDeploymentId(model);
  if (selectedDeploymentId) {
    return getVllmChatEndpoint(selectedDeploymentId);
  }

  if (model === 'vllm-model') {
    // vLLM deployment route only. No fallback to legacy static vLLM route.
    return vllmDeploymentId
      ? getVllmChatEndpoint(vllmDeploymentId)
      : '/api/v1/deployment/__missing__/chat/completions';
  }
  return '/api/chat';
};

const showErrorToast = (message: string) => {
  toast({
    title: 'Request failed',
    description: message,
    variant: 'destructive',
  });
};

const areMessagesEquivalent = (left: UIMessage, right: UIMessage): boolean => {
  if (left.id === right.id) {
    return true;
  }

  return left.role === right.role && JSON.stringify(left.parts) === JSON.stringify(right.parts);
};

const isPrefixOf = (candidate: UIMessage[], full: UIMessage[]): boolean => {
  if (candidate.length > full.length) {
    return false;
  }

  return candidate.every((message, index) => {
    const target = full[index];
    return target ? areMessagesEquivalent(message, target) : false;
  });
};

function toStreamDelta(dataPart: any): DataStreamDelta | null {
  if (!dataPart || typeof dataPart.type !== 'string') return null;
  if (!dataPart.type.startsWith('data-')) return null;

  const type = dataPart.type.slice('data-'.length) as DataStreamDelta['type'];

  const supportedTypes: Array<DataStreamDelta['type']> = [
    'text-delta',
    'code-delta',
    'sheet-delta',
    'image-delta',
    'title',
    'id',
    'suggestion',
    'clear',
    'finish',
    'kind',
  ];

  if (!supportedTypes.includes(type)) return null;

  return {
    type,
    content: dataPart.data,
  };
}

function getGuestMessageCountFromCookie(): number {
  if (typeof document === 'undefined') {
    return 0;
  }
  return getGuestMessageCount(document.cookie);
}

function ensureModelReadyForSend({
  isGuestMode,
  selectedModel,
  vllmDeploymentId,
}: {
  isGuestMode: boolean;
  selectedModel: string;
  vllmDeploymentId: string | null;
}): boolean {
  if (isGuestMode) {
    return true;
  }

  if (!isVllmDeploymentModel(selectedModel)) {
    return true;
  }

  // Deployment-specific options include the job ID directly.
  if (getSelectedVllmDeploymentId(selectedModel)) {
    return true;
  }

  if (vllmDeploymentId) {
    return true;
  }

  showErrorToast(
    'Model deployment is still initializing. Please wait a few seconds and try again.',
  );  
  return false;
}

function handleChatRequestError({
  error,
  isGuestMode,
  onGuestLimitReached,
}: {
  error: unknown;
  isGuestMode: boolean;
  onGuestLimitReached?: () => void;
}) {
  const errorMessage = normalizeChatRequestError(error);
  if (isGuestMode && isGuestLimitErrorMessage(errorMessage)) {
    onGuestLimitReached?.();
    return;
  }
  showErrorToast(errorMessage);
}

// Inner component that handles the actual chat logic.
function ChatInner({
  chatId,
  apiEndpoint,
  selectedModel,
  vllmDeploymentId,
  initialMessages,
  initialDocuments,
  initialVotes,
  isTemporaryChat,
  isReadonly,
  isGuestMode,
  onGuestLimitReached,
  initialPrompt,
}: {
  chatId: string;
  apiEndpoint: string;
  selectedModel: string;
  vllmDeploymentId: string | null;
  initialMessages: Array<UIMessage>;
  initialDocuments?: Array<Document>;
  initialVotes?: Array<Vote>;
  isTemporaryChat: boolean;
  isReadonly: boolean;
  isGuestMode: boolean;
  onGuestLimitReached?: () => void;
  initialPrompt?: string;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [votes, setVotes] = useState<Array<Vote>>(initialVotes || []);
  const [attachments, setAttachments] = useState<Array<UploadedAttachment>>([]);
  const [input, setInput] = useState('');
  const hasAutoSentInitialPrompt = useRef(false);
  const autoSentPendingRef = useRef(false);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);
  const setHasDraftMessages = useNewChat((state) => state.setHasDraftMessages);

  const { artifact, setArtifact, setMetadata } = useArtifact();

  // Initialize document cache with initialDocuments
  const { addDocuments } = useDocumentCache();

  useEffect(() => {
    if (initialDocuments?.length) {
      const documentsByIds = initialDocuments.reduce(
        (acc, doc) => {
          if (!acc[doc.id]) {
            acc[doc.id] = [];
          }
          acc[doc.id].push(doc);
          return acc;
        },
        {} as Record<string, Document[]>,
      );

      Object.entries(documentsByIds).forEach(([docId, docs]) => {
        addDocuments(docId, docs);
      });
    }
  }, [initialDocuments, addDocuments]);

  const routeAwareChatId = useMemo(
    () => `${chatId}:${selectedModel}:${apiEndpoint}`,
    [chatId, selectedModel, apiEndpoint],
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: apiEndpoint,
        headers: {
          // This header specifies that the API should return the response in the streaming format
          'x-response-format': 'ai-sdk',
        },
        prepareSendMessagesRequest: ({
          messages,
          trigger,
          messageId,
          body,
          headers,
          credentials,
        }) => {
          return {
            api: apiEndpoint,
            headers,
            credentials,
            body: {
              ...body,
              id: chatId,
              messages,
              trigger,
              messageId,
              selectedChatModel: selectedModel,
              ...(isVllmDeploymentModel(selectedModel) && vllmDeploymentId
                ? { vllmDeploymentId }
                : {}),
            },
          };
        },
      }),
    [apiEndpoint, chatId, selectedModel, vllmDeploymentId],
  );

  const {
    messages,
    setMessages,
    sendMessage,
    stop,
    status,
  } = useChat({
    id: routeAwareChatId,
    transport,
    messages: initialMessages,
    generateId: generateUUID,
    onFinish: () => {
      queryClient.invalidateQueries({ queryKey: ['chatHistory'] });
    },
    onError: (error) => {
      handleChatRequestError({ error, isGuestMode, onGuestLimitReached });
    },
    onData: (dataPart) => {
      const delta = toStreamDelta(dataPart);
      if (!delta) return;

      const artifactDefinition = artifactDefinitions.find(
        (artifactDefinition) => artifactDefinition.kind === artifact.kind,
      );

      if (artifactDefinition?.onStreamPart) {
        artifactDefinition.onStreamPart({
          streamPart: delta,
          setArtifact,
          setMetadata,
        });
      }

      setArtifact((draftArtifact) => {
        const next = draftArtifact ?? { ...initialArtifactData, status: 'streaming' };

        switch (delta.type) {
          case 'id':
            return {
              ...next,
              documentId: delta.content as string,
              status: 'streaming',
            };

          case 'title':
            return {
              ...next,
              title: delta.content as string,
              status: 'streaming',
            };

          case 'kind':
            return {
              ...next,
              kind: delta.content as ArtifactKind,
              status: 'streaming',
            };

          case 'clear':
            return {
              ...next,
              content: '',
              status: 'streaming',
            };

          case 'finish':
            return {
              ...next,
              status: 'idle',
            };

          default:
            return next;
        }
      });
    },
  });

  const isLoading = status === 'submitted' || status === 'streaming';

  const guardedSendMessage = async (
    message?: any,
    options?: ChatRequestOptions,
  ): Promise<void> => {
    if (!ensureModelReadyForSend({ isGuestMode, selectedModel, vllmDeploymentId })) {
      return;
    }

    if (
      isGuestMode &&
      getGuestMessageCountFromCookie() >= GUEST_CHAT_MAX_MESSAGES
    ) {
      onGuestLimitReached?.();
      return;
    }

    // For the first message of a logged-in temporary chat, stash the payload
    // and redirect to the real /chat/[id] route so that the stream starts there
    // rather than on the transient /chat page.
    if (isTemporaryChat && !isGuestMode && messages.length === 0) {
      usePendingChat.getState().set(chatId, { message, options });
      router.replace(`/chat/${chatId}`);
      return;
    }

    try {
      await sendMessage(message, options);
    } catch (error) {
      handleChatRequestError({ error, isGuestMode, onGuestLimitReached });
    }
  };

  const lastNonEmptyMessagesRef = useRef<Array<UIMessage>>(initialMessages);
  const previousSessionRouteRef = useRef(`${selectedModel}|${apiEndpoint}`);

  useEffect(() => {
    if (messages.length === 0) {
      return;
    }

    const snapshot = lastNonEmptyMessagesRef.current;
    const isTruncatedRouteTransition =
      snapshot.length > messages.length && isPrefixOf(messages, snapshot);

    if (isTruncatedRouteTransition) {
      return;
    }

    lastNonEmptyMessagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const currentSessionRoute = `${selectedModel}|${apiEndpoint}`;
    if (previousSessionRouteRef.current === currentSessionRoute) {
      return;
    }

    previousSessionRouteRef.current = currentSessionRoute;
    const previousMessages = lastNonEmptyMessagesRef.current;

    if (previousMessages.length === 0) {
      return;
    }

    setMessages((currentMessages) => {
      if (currentMessages.length === 0) {
        return previousMessages;
      }

      const isPrefixOfPrevious =
        currentMessages.length < previousMessages.length &&
        isPrefixOf(currentMessages, previousMessages);

      return isPrefixOfPrevious ? previousMessages : currentMessages;
    });
  }, [selectedModel, apiEndpoint, setMessages]);

  useEffect(() => {
    if (!isTemporaryChat) {
      setHasDraftMessages(false);
      return;
    }

    setHasDraftMessages(messages.length > 0);
  }, [isTemporaryChat, messages.length, setHasDraftMessages]);

  useEffect(() => {
    if (!initialPrompt || hasAutoSentInitialPrompt.current) {
      return;
    }

    if (messages.length > 0) {
      return;
    }

    hasAutoSentInitialPrompt.current = true;
    // Route through guardedSendMessage so that logged-in temporary chats
    // redirect to /chat/[id] before streaming begins.
    void guardedSendMessage({ text: initialPrompt });
  }, [
    initialPrompt,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    messages.length,
  ]);

  // On the real /chat/[id] route, fire the stashed payload from a prior redirect
  // and immediately clear the store so it never runs twice.
  useEffect(() => {
    if (isTemporaryChat || autoSentPendingRef.current || messages.length > 0) {
      return;
    }
    const pending = usePendingChat.getState().pending[chatId];
    if (!pending) return;
    autoSentPendingRef.current = true;
    usePendingChat.getState().clear(chatId);
    void guardedSendMessage(pending.message, pending.options);
    // guardedSendMessage is stable for the lifetime of this ChatInner mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTemporaryChat, chatId, messages.length]);

  const { data: fetchedVotes } = useSWR<Array<Vote>>(
    !isTemporaryChat && !initialVotes ? `/api/vote?chatId=${chatId}` : null,
    fetcher,
  );

  useEffect(() => {
    if (fetchedVotes) {
      setVotes(fetchedVotes);
    }
  }, [fetchedVotes]);

  return (
    <>
      <div className="flex flex-col min-w-0 h-full bg-transparent">
        <div className="relative flex-1 overflow-hidden">
          <div className="absolute inset-0 flex flex-col">
            <Messages
              chatId={chatId}
              isLoading={isLoading}
              votes={votes}
              messages={messages}
              setMessages={setMessages}
              sendMessage={guardedSendMessage}
              isReadonly={isReadonly}
              isArtifactVisible={isArtifactVisible}
            />

            <div className="shrink-0 bg-transparent">
              <div className="max-w-3xl mx-auto px-4">
                <div className="flex pb-4 md:pb-6 gap-2 w-full">
                  {!isReadonly && (
                    <MultimodalInput
                      input={input}
                      setInput={setInput}
                      isLoading={isLoading}
                      stop={stop}
                      attachments={attachments}
                      setAttachments={setAttachments}
                      messages={messages}
                      setMessages={setMessages}
                      sendMessage={guardedSendMessage}
                      isGuestMode={isGuestMode}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Artifact
        chatId={chatId}
        input={input}
        setInput={setInput}
        isLoading={isLoading}
        stop={stop}
        attachments={attachments}
        setAttachments={setAttachments}
        sendMessage={guardedSendMessage}
        messages={messages}
        setMessages={setMessages}
        votes={votes}
        isReadonly={isReadonly}
        initialDocuments={initialDocuments}
      />
    </>
  );
}

export function Chat({
  id,
  initialMessages,
  initialVotes,
  initialDocuments,
  selectedVisibilityType: _selectedVisibilityType,
  isReadonly,
  isGuestMode = false,
  onGuestLimitReached,
  initialPrompt,
  resetVersion = 0,
  onResolvedChatId,
}: {
  id: string;
  initialMessages: Array<UIMessage>;
  initialVotes?: Array<Vote>;
  initialDocuments?: Array<Document>;
  selectedVisibilityType: VisibilityType;
  isReadonly: boolean;
  isGuestMode?: boolean;
  onGuestLimitReached?: () => void;
  initialPrompt?: string;
  resetVersion?: number;
  onResolvedChatId?: (chatId: string) => void;
}) {
  const { selectedModel, setSelectedModel } = useModelSelector();
  const effectiveSelectedModel = isGuestMode ? 'guest-vllm-model' : selectedModel;
  const { deploymentId: vllmDeploymentId } = useVllmJob(!isGuestMode);
  const isTemporaryChat = id === 'new';
  const chatKey = isTemporaryChat ? `new:${resetVersion}` : `id:${id}`;
  const [chatIdentity, setChatIdentity] = useState(() => ({
    key: chatKey,
    chatId: isTemporaryChat ? generateUUID() : id,
  }));

  useEffect(() => {
    setChatIdentity((prev) => {
      if (prev.key === chatKey) return prev;
      return { key: chatKey, chatId: isTemporaryChat ? generateUUID() : id };
    });
  }, [chatKey, isTemporaryChat, id]);

  const chatId = chatIdentity.chatId;

  // Determine API endpoint based on selected model and vLLM deployment ID
  const apiEndpoint = getApiEndpoint(effectiveSelectedModel, vllmDeploymentId);

  useEffect(() => {
    onResolvedChatId?.(chatId);
  }, [chatId, onResolvedChatId]);

  useEffect(() => {
    if (isGuestMode) {
      setSelectedModel('vllm-model');
    }
  }, [isGuestMode, setSelectedModel]);

  return (
    <ChatInner
      key={chatId}
      chatId={chatId}
      apiEndpoint={apiEndpoint}
      selectedModel={effectiveSelectedModel}
      vllmDeploymentId={vllmDeploymentId}
      initialMessages={initialMessages}
      initialDocuments={initialDocuments}
      initialVotes={initialVotes}
      isTemporaryChat={isTemporaryChat}
      isReadonly={isReadonly}
      isGuestMode={isGuestMode}
      onGuestLimitReached={onGuestLimitReached}
      initialPrompt={initialPrompt}
    />
  );
}
