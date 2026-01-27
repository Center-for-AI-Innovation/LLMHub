'use client';

import type { Attachment, Message, ChatRequestOptions } from 'ai';
import { useChat } from 'ai/react';
import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

import type { Vote, Document } from '@/lib/db/schema';
import { fetcher, generateUUID } from '@/lib/utils';

import { Artifact } from './artifact';
import { MultimodalInput } from './multimodal-input';
import { Messages } from './messages';
import type { VisibilityType } from './visibility-selector';
import { useArtifactSelector } from '@/hooks/use-artifact';
import { toast } from 'sonner';
import { useModelSelector } from '@/hooks/use-model-selector';
import { useDocumentCache } from '@/hooks/use-document-cache';
import { useVllmJob, getVllmChatEndpoint } from '@/hooks/use-vllm-job';

// Helper to determine API endpoint based on model and job ID
const getApiEndpoint = (model: string, vllmJobId: string | null) => {
  if (model === 'vllm-model') {
    // Use job-based proxy if job ID is available, otherwise fallback to static proxy
    return vllmJobId ? getVllmChatEndpoint(vllmJobId) : '/api/vllm/chat';
  }
  return '/api/chat';
};

// Inner component that handles the actual chat logic
// Using a key on this component forces complete re-mount when API endpoint changes
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
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [hasCreatedChat, setHasCreatedChat] = useState(false);
  const [votes, setVotes] = useState<Array<Vote>>(initialVotes || []);
  const [attachments, setAttachments] = useState<Array<Attachment>>([]);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);
  
  // Initialize document cache with initialDocuments
  const { addDocuments } = useDocumentCache();
  
  useEffect(() => {
    if (initialDocuments?.length) {
      const documentsByIds = initialDocuments.reduce((acc, doc) => {
        if (!acc[doc.id]) {
          acc[doc.id] = [];
        }
        acc[doc.id].push(doc);
        return acc;
      }, {} as Record<string, Document[]>);
      
      Object.entries(documentsByIds).forEach(([docId, docs]) => {
        addDocuments(docId, docs);
      });
    }
  }, [initialDocuments, addDocuments]);

  // Log when using vLLM job-based proxy
  useEffect(() => {
    if (selectedModel === 'vllm-model' && vllmJobId) {
      console.log(`[Chat] Using vLLM job-based proxy with job ID: ${vllmJobId}`);
      console.log(`[Chat] API endpoint: ${apiEndpoint}`);
    }
  }, [selectedModel, vllmJobId, apiEndpoint]);

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
      // Request AI SDK data stream format for useChat hook compatibility
      // Without this header, the API returns standard OpenAI SSE format
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
      if (!isTemporaryChat) {
        queryClient.invalidateQueries({ queryKey: ['chatHistory'] });
      }
    },
    onError: (error) => {
      console.error('[Chat] Error:', error);
      toast.error('An error occurred, please try again!');
    },
  });

  const handleFormSubmit = async (event?: { preventDefault?: () => void }, chatRequestOptions?: ChatRequestOptions) => {
    event?.preventDefault?.();
    
    if (messages.length === 0 && isTemporaryChat) {
      handleSubmit(event, chatRequestOptions);
      return;
    }

    if (isTemporaryChat && !hasCreatedChat) {
      try {
        const response = await fetch('/api/chat/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: chatId }),
        });
        if (!response.ok) throw new Error('Failed to create chat');
        setHasCreatedChat(true);
        router.replace(`/chat/${chatId}`, { scroll: false });
      } catch (error) {
        toast.error('Failed to create chat');
        return;
      }
    }

    handleSubmit(event, chatRequestOptions);
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
                <form onSubmit={handleFormSubmit} className="flex pb-4 md:pb-6 gap-2 w-full">
                  {!isReadonly && (
                    <MultimodalInput
                      chatId={chatId}
                      input={input}
                      setInput={setInput}
                      handleSubmit={handleFormSubmit}
                      isLoading={isLoading}
                      stop={stop}
                      attachments={attachments}
                      setAttachments={setAttachments}
                      messages={messages}
                      setMessages={setMessages}
                      append={append}
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
}: {
  id: string;
  initialMessages: Array<Message>;
  initialVotes?: Array<Vote>;
  initialDocuments?: Array<Document>;
  selectedVisibilityType: VisibilityType;
  isReadonly: boolean;
}) {
  const { selectedModel } = useModelSelector();
  const { jobId: vllmJobId, isLoading: isVllmJobLoading } = useVllmJob();
  const isTemporaryChat = id === 'new';
  const [chatId] = useState(isTemporaryChat ? generateUUID() : id);
  
  // Determine API endpoint based on selected model and vLLM job ID
  const apiEndpoint = getApiEndpoint(selectedModel, vllmJobId);

  // Show loading state while vLLM job ID is being loaded
  if (selectedModel === 'vllm-model' && isVllmJobLoading) {
    return (
      <div className="flex flex-col min-w-0 h-full bg-transparent items-center justify-center">
        <div className="text-muted-foreground">Initializing vLLM connection...</div>
      </div>
    );
  }

  // Use a key that includes the API endpoint to force complete re-mount
  // when the model type changes. This ensures useChat hook is fully re-initialized.
  return (
    <ChatInner
      key={`${chatId}-${apiEndpoint}`}
      chatId={chatId}
      apiEndpoint={apiEndpoint}
      selectedModel={selectedModel}
      vllmJobId={vllmJobId}
      initialMessages={initialMessages}
      initialDocuments={initialDocuments}
      initialVotes={initialVotes}
      isTemporaryChat={isTemporaryChat}
      isReadonly={isReadonly}
    />
  );
}
