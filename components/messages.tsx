import type { ChatRequestOptions, Message } from 'ai';
import { PreviewMessage, ThinkingMessage } from './message';
import { useScrollToBottom } from './use-scroll-to-bottom';
import { Overview } from './overview';
import { memo } from 'react';
import type { Vote } from '@/lib/db/schema';
import equal from 'fast-deep-equal';

interface MessagesProps {
  chatId: string;
  isLoading: boolean;
  votes: Array<Vote> | undefined;
  messages: Array<Message>;
  setMessages: (
    messages: Message[] | ((messages: Message[]) => Message[]),
  ) => void;
  reload: (
    chatRequestOptions?: ChatRequestOptions,
  ) => Promise<string | null | undefined>;
  isReadonly: boolean;
  isArtifactVisible: boolean;
}

export const Messages = memo(function Messages({
  chatId,
  isLoading,
  votes,
  messages,
  setMessages,
  reload,
  isReadonly,
  isArtifactVisible,
}: MessagesProps) {
  const isTemporaryChat = chatId === 'new';
  const [containerRef, endRef] = useScrollToBottom<HTMLDivElement>();

  if (messages.length === 0) {
    return (
      <div ref={containerRef} className="flex-1 overflow-y-auto py-8 space-y-6 scrollbar-thin scrollbar-thumb-primary/10 hover:scrollbar-thumb-primary/20 scrollbar-track-transparent">
        <Overview isArtifactVisible={isArtifactVisible} />
        <div ref={endRef} className="h-[24px]" />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto py-8 my-8 space-y-6 scrollbar-thin scrollbar-thumb-primary/10 hover:scrollbar-thumb-primary/20 scrollbar-track-transparent">
      {messages.map((message) => (
        <PreviewMessage
          key={message.id}
          chatId={chatId}
          message={message}
          vote={isTemporaryChat ? undefined : votes?.find((v) => v.messageId === message.id)}
          isLoading={isLoading}
          setMessages={setMessages}
          reload={reload}
          isReadonly={isReadonly}
        />
      ))}
      {isLoading && <ThinkingMessage />}
      <div ref={endRef} className="h-[24px]" />
    </div>
  );
}, equal);
