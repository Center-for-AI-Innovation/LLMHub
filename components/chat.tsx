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
import { VisibilityType } from './visibility-selector';
import { useArtifactSelector } from '@/hooks/use-artifact';
import { toast } from 'sonner';
import { useModelSelector } from '@/hooks/use-model-selector';
import { useDocumentCache } from '@/hooks/use-document-cache';

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
  const queryClient = useQueryClient();
  const router = useRouter();
  const isTemporaryChat = id === 'new';
  const [chatId, setChatId] = useState(isTemporaryChat ? generateUUID() : id);
  const [hasCreatedChat, setHasCreatedChat] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [votes, setVotes] = useState<Array<Vote>>(initialVotes || []);
  
  // Initialize document cache with initialDocuments
  const { addDocuments } = useDocumentCache();
  
  useEffect(() => {
    if (initialDocuments?.length) {
      // Group documents by ID
      const documentsByIds = initialDocuments.reduce((acc, doc) => {
        if (!acc[doc.id]) {
          acc[doc.id] = [];
        }
        acc[doc.id].push(doc);
        return acc;
      }, {} as Record<string, Document[]>);
      
      // Add each group to the global cache
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
    body: { id: chatId, selectedChatModel: selectedModel },
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
      toast.error('An error occurred, please try again!');
    },
  });

  const handleFormSubmit = async (event?: { preventDefault?: () => void }, chatRequestOptions?: ChatRequestOptions) => {
    event?.preventDefault?.();
    
    // If current chat is empty and user clicks new chat, stay on current chat
    if (messages.length === 0 && isTemporaryChat) {
      handleSubmit(event, chatRequestOptions);
      return;
    }

    // Create chat in DB only on first message for new chats
    if (isTemporaryChat && !hasCreatedChat) {
      try {
        const response = await fetch('/api/chat/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
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

  // Only fetch votes if not provided through initialVotes
  const { data: fetchedVotes } = useSWR<Array<Vote>>(
    !isTemporaryChat && !initialVotes ? `/api/vote?chatId=${chatId}` : null,
    fetcher,
  );

  // Update votes when fetchedVotes changes
  useEffect(() => {
    if (fetchedVotes) {
      setVotes(fetchedVotes);
    }
  }, [fetchedVotes]);

  const [attachments, setAttachments] = useState<Array<Attachment>>([]);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);

  const handleEditSubmit = (editedMessage: Message) => {
    // Implementation of handleEditSubmit
  };

  return (
    <>
      <div className="flex flex-col min-w-0 h-full bg-background">
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

            <div className="shrink-0 bg-background">
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
