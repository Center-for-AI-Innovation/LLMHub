'use client';

import type { ChatRequestOptions, UIMessage } from 'ai';
import { Button } from './ui/button';
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react';
import { Textarea } from './ui/textarea';
import { deleteTrailingMessages } from '@/app/(chat)/actions';
import { getTextFromUIMessage } from '@/lib/utils';

export type MessageEditorProps = {
  message: UIMessage;
  setMode: Dispatch<SetStateAction<'view' | 'edit'>>;
  setMessages: (
    messages: UIMessage[] | ((messages: UIMessage[]) => UIMessage[]),
  ) => void;
  sendMessage: (
    message?: any,
    options?: ChatRequestOptions,
  ) => Promise<void>;
};

export function MessageEditor({
  message,
  setMode,
  setMessages,
  sendMessage,
}: MessageEditorProps) {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const [draftContent, setDraftContent] = useState<string>(getTextFromUIMessage(message));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight + 2}px`;
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight();
    }
  }, []);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraftContent(event.target.value);
    adjustHeight();
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      <Textarea
        ref={textareaRef}
        className="bg-transparent outline-none overflow-hidden resize-none !text-base rounded-xl w-full"
        value={draftContent}
        onChange={handleInput}
      />

      <div className="flex flex-row gap-2 justify-end">
        <Button
          variant="outline"
          className="h-fit py-2 px-3"
          onClick={() => {
            setMode('view');
          }}
        >
          Cancel
        </Button>
        <Button
          variant="default"
          className="h-fit py-2 px-3"
          disabled={isSubmitting}
          onClick={async () => {
            setIsSubmitting(true);

            await deleteTrailingMessages({
              id: message.id,
            });

            setMessages((messages) => {
              const index = messages.findIndex((m) => m.id === message.id);
              if (index === -1) return messages;

              const updatedMessage: UIMessage = {
                ...message,
                parts: [
                  ...message.parts.filter((part) => part.type !== 'text'),
                  { type: 'text', text: draftContent },
                ],
              };

              return [...messages.slice(0, index), updatedMessage];
            });

            setMode('view');
            await sendMessage(
              {
                role: 'user',
                messageId: message.id,
                parts: [
                  ...message.parts.filter((part) => part.type !== 'text'),
                  { type: 'text', text: draftContent },
                ],
              },
              undefined,
            );
          }}
        >
          {isSubmitting ? 'Sending...' : 'Send'}
        </Button>
      </div>
    </div>
  );
}
