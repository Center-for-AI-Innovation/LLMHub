'use client';

import type { Attachment, Message, ChatRequestOptions } from 'ai';
import { useChat } from 'ai/react';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import useSWR from 'swr';
import { useQueryClient } from '@tanstack/react-query';

import type { Vote, Document } from '@/lib/db/schema';
import { fetcher, generateUUID } from '@/lib/utils';

import { Artifact } from './artifact';
import { MultimodalInput } from './multimodal-input';
import { Messages } from './messages';
import type { VisibilityType } from './visibility-selector';
import { useArtifactSelector } from '@/hooks/use-artifact';
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

// Helper to determine API endpoint based on model and job ID
const getApiEndpoint = (model: string, vllmJobId: string | null) => {
  if (model === 'guest-vllm-model' || model === 'always-on-model') {
    return '/api/public/chat';
  }

  if (model === 'vllm-model') {
    // Use job-based proxy if job ID is available, otherwise fallback to static proxy
    return vllmJobId ? getVllmChatEndpoint(vllmJobId) : '/api/vllm/chat';
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

// Inner component that handles the actual chat logic.
function ChatInner({
  chatId,
  apiEndpoint,
  selectedModel,
  vllmJobId,
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
  vllmJobId: string | null;
  initialMessages: Array<Message>;
  initialDocuments?: Array<Document>;
  initialVotes?: Array<Vote>;
  isTemporaryChat: boolean;
  isReadonly: boolean;
  isGuestMode: boolean;
  onGuestLimitReached?: () => void;
  initialPrompt?: string;
}) {
  const queryClient = useQueryClient();
  const [votes, setVotes] = useState<Array<Vote>>(initialVotes || []);
  const [attachments, setAttachments] = useState<Array<Attachment>>([]);
  const hasAutoSentInitialPrompt = useRef(false);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);
  const setHasDraftMessages = useNewChat((state) => state.setHasDraftMessages);

  // Initialize document cache with initialDocuments
  const { addDocuments } = useDocumentCache();

  const getGuestMessageCountFromCookie = useCallback(() => {
    if (typeof document === 'undefined') {
      return 0;
    }
    return getGuestMessageCount(document.cookie);
  }, []);

  const handleChatRequestError = useCallback(
    (error: unknown) => {
      const errorMessage = normalizeChatRequestError(error);
      if (isGuestMode && isGuestLimitErrorMessage(errorMessage)) {
        onGuestLimitReached?.();
        return;
      }
      showErrorToast(errorMessage);
    },
    [isGuestMode, onGuestLimitReached],
  );

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

  const {
    messages,
    setMessages,
    handleSubmit,
    input,
    setInput,
    append,
    isLoading,
    stop,
    reload,
  } = useChat({
    id: chatId,
    api: apiEndpoint,
    headers: {
      // This header specifies that the API should return the response in the streaming format
      'x-response-format': 'ai-sdk',
    },
    body: {
      id: chatId,
      selectedChatModel: selectedModel,
      // Include vLLM job ID for tracking (optional, for logging)
      ...(selectedModel === 'vllm-model' && vllmJobId ? { vllmJobId } : {}),
    },
    initialMessages,
    experimental_throttle: 100,
    sendExtraMessageFields: true,
    generateId: generateUUID,
    onFinish: () => {
      queryClient.invalidateQueries({ queryKey: ['chatHistory'] });
    },
    onError: handleChatRequestError,
  });

  const lastNonEmptyMessagesRef = useRef<Array<Message>>(initialMessages);
  const previousSessionRouteRef = useRef(`${selectedModel}|${apiEndpoint}`);

  useEffect(() => {
    if (messages.length > 0) {
      lastNonEmptyMessagesRef.current = messages;
    }
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
        currentMessages.every(
          (message, index) => previousMessages[index]?.id === message.id,
        );

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

    if (
      isGuestMode &&
      getGuestMessageCountFromCookie() >= GUEST_CHAT_MAX_MESSAGES
    ) {
      onGuestLimitReached?.();
      return;
    }

    hasAutoSentInitialPrompt.current = true;
    void append({ role: 'user', content: initialPrompt }).catch(
      handleChatRequestError,
    );
  }, [
    append,
    getGuestMessageCountFromCookie,
    handleChatRequestError,
    initialPrompt,
    isGuestMode,
    messages.length,
    onGuestLimitReached,
  ]);

  const handleFormSubmit = (
    event?: { preventDefault?: () => void },
    chatRequestOptions?: ChatRequestOptions,
  ) => {
    event?.preventDefault?.();

    if (isGuestMode) {
      const trimmedInput = input.trim();
      if (!trimmedInput) {
        return;
      }

      if (getGuestMessageCountFromCookie() >= GUEST_CHAT_MAX_MESSAGES) {
        onGuestLimitReached?.();
        return;
      }
    }

    try {
      const result = handleSubmit(event, chatRequestOptions);
      void Promise.resolve(result).catch(handleChatRequestError);
    } catch (error) {
      handleChatRequestError(error);
    }
  };

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
              reload={reload}
              isReadonly={isReadonly}
              isArtifactVisible={isArtifactVisible}
            />

            <div className="shrink-0 bg-transparent">
              <div className="max-w-3xl mx-auto px-4 md:px-0">
                <form
                  onSubmit={handleFormSubmit}
                  className="flex pb-4 md:pb-6 gap-2 w-full"
                >
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
                      append={append}
                      isGuestMode={isGuestMode}
                    />
                  )}
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Artifact
        chatId={chatId}
        input={input}
        setInput={setInput}
        handleSubmit={handleFormSubmit}
        isLoading={isLoading}
        stop={stop}
        attachments={attachments}
        setAttachments={setAttachments}
        append={append}
        messages={messages}
        setMessages={setMessages}
        reload={reload}
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
  selectedVisibilityType,
  isReadonly,
  isGuestMode = false,
  onGuestLimitReached,
  initialPrompt,
  resetVersion = 0,
  onResolvedChatId,
}: {
  id: string;
  initialMessages: Array<Message>;
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
  const effectiveSelectedModel = isGuestMode
    ? 'guest-vllm-model'
    : selectedModel;
  const { jobId: vllmJobId } = useVllmJob(!isGuestMode);
  const isTemporaryChat = id === 'new';
  const chatId = useMemo(() => {
    if (!isTemporaryChat) {
      return id;
    }

    // Reset version intentionally forces a new temporary chat id.
    void resetVersion;
    return generateUUID();
  }, [isTemporaryChat, id, resetVersion]);

  // Determine API endpoint based on selected model and vLLM job ID
  const apiEndpoint = getApiEndpoint(effectiveSelectedModel, vllmJobId);

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
      vllmJobId={vllmJobId}
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
