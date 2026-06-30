'use client';

import type { ChatRequestOptions, UIMessage } from 'ai';
import cx from 'classnames';
import type React from 'react';
import {
  useRef,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
  type ChangeEvent,
  memo,
} from 'react';
import { toast } from 'sonner';
import { useWindowSize } from '@/hooks/use-window-size';

import { extractErrorMessage } from '@/lib/chat-client-errors';
import { sanitizeUIMessages } from '@/lib/utils';
import type { UploadedAttachment } from '@/lib/chat-attachments';
import { toFileUIPart } from '@/lib/chat-attachments';

import { ArrowUpIcon, PaperclipIcon, StopIcon } from './icons';
import { PreviewAttachment } from './preview-attachment';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { SuggestedActions } from './suggested-actions';
import equal from 'fast-deep-equal';
import { ModelSelector } from './model-selector';

function PureMultimodalInput({
  input,
  setInput,
  isLoading,
  stop,
  attachments,
  setAttachments,
  messages,
  setMessages,
  sendMessage,
  className,
  isGuestMode = false,
}: {
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  stop: () => void;
  attachments: Array<UploadedAttachment>;
  setAttachments: Dispatch<SetStateAction<Array<UploadedAttachment>>>;
  messages: Array<UIMessage>;
  setMessages: Dispatch<SetStateAction<Array<UIMessage>>>;
  sendMessage: (message?: any, options?: ChatRequestOptions) => Promise<void>;
  className?: string;
  isGuestMode?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { width } = useWindowSize();

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight();
    }
  }, []);

  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight + 2}px`;
    }
  };

  const resetHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = '98px';
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      const domValue = textareaRef.current.value;
      const storedValue =
        typeof window !== 'undefined' ? localStorage.getItem('input') : '';
      // Prefer DOM value over localStorage to handle hydration
      const finalValue = domValue || storedValue || '';
      setInput(finalValue);
      adjustHeight();
    }
    // Only run once after hydration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('input', input);
    } catch {
      // Ignore localStorage write errors (e.g. privacy mode).
    }
  }, [input]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
    adjustHeight();
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadQueue, setUploadQueue] = useState<Array<string>>([]);

  const submitForm = () => {
    const trimmedInput = input.trim();
    if (!trimmedInput && attachments.length === 0) {
      return;
    }

    const files = attachments.map(toFileUIPart);

    const messagePayload = trimmedInput
      ? ({ text: input, files: files.length > 0 ? files : undefined } as const)
      : ({ files } as const);

    void sendMessage(messagePayload).catch((error) => {
      const message = extractErrorMessage(error, 'Failed to send message');
      toast.error(message);
    });

    setAttachments([]);
    setInput('');
    try {
      // Keep the key but clear the value to avoid hydration edge cases.
      localStorage.setItem('input', '');
    } catch {
      // ignore
    }
    resetHeight();

    if (width && width > 768) {
      textareaRef.current?.focus();
    }
  };

  const uploadFile = async (file: File): Promise<UploadedAttachment | undefined> => {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        const { url, pathname, contentType } = data;

        return {
          url,
          name: pathname,
          contentType,
        };
      }
      const { error } = await response.json();
      toast.error(error);
    } catch {
      toast.error('Failed to upload file, please try again!');
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);

    setUploadQueue(files.map((file) => file.name));

    try {
      const uploadPromises = files.map((file) => uploadFile(file));
      const uploadedAttachments = await Promise.all(uploadPromises);
      const successfullyUploadedAttachments = uploadedAttachments.filter(
        (attachment): attachment is UploadedAttachment => attachment !== undefined,
      );

      setAttachments((currentAttachments) => [
        ...currentAttachments,
        ...successfullyUploadedAttachments,
      ]);
    } catch (error) {
      console.error('Error uploading files!', error);
    } finally {
      setUploadQueue([]);
    }
  };

  return (
    <div className="relative w-full flex flex-col gap-4">
      {messages.length === 0 &&
        attachments.length === 0 &&
        uploadQueue.length === 0 &&
        !isGuestMode && <SuggestedActions sendMessage={sendMessage} />}

      <input
        type="file"
        className="fixed -top-4 -left-4 size-0.5 opacity-0 pointer-events-none"
        ref={fileInputRef}
        multiple
        onChange={handleFileChange}
        tabIndex={-1}
      />

      {(attachments.length > 0 || uploadQueue.length > 0) && (
        <div className="flex flex-row gap-2 overflow-x-scroll items-end">
          {attachments.map((attachment) => (
            <PreviewAttachment key={attachment.url} attachment={attachment} />
          ))}

          {uploadQueue.map((filename) => (
            <PreviewAttachment
              key={filename}
              attachment={{
                url: '',
                name: filename,
                contentType: '',
              }}
              isUploading={true}
            />
          ))}
        </div>
      )}

      <Textarea
        ref={textareaRef}
        placeholder="Send a message..."
        value={input}
        onChange={handleInput}
        className={cx(
          'min-h-[24px] max-h-[calc(100vh-14rem)] overflow-hidden resize-none rounded-2xl !text-base bg-background pb-12 pt-4 px-4 dark:bg-muted/50 border-0 shadow-[0_2px_6px_rgba(0,0,0,0.05)] dark:shadow-[0_2px_6px_rgba(0,0,0,0.25)] focus-visible:ring-1 focus-visible:ring-accent/50 dark:focus-visible:ring-accent/25',
          className,
        )
        }
        rows={2}
        autoFocus
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();

            if (isLoading) {
              toast.error('Please wait for the model to finish its response!');
            } else {
              submitForm();
            }
          }
        }}
      />

      <div className="absolute bottom-3 left-3 w-fit flex flex-row justify-start">
        <AttachmentsButton fileInputRef={fileInputRef} isLoading={isLoading} />
      </div>

      <div className="absolute bottom-3 right-3 w-fit flex flex-row justify-end gap-2">
        {isLoading ? (
          <StopButton stop={stop} setMessages={setMessages} />
        ) : (
          <>
            <ModelSelector className="hidden md:flex" />
            <SendButton
              input={input}
              submitForm={submitForm}
              uploadQueue={uploadQueue}
              canSend={input.trim().length > 0 || attachments.length > 0}
            />
          </>
        )}
      </div>
    </div>
  );
}

export const MultimodalInput = memo(
  PureMultimodalInput,
  (prevProps, nextProps) => {
    if (prevProps.input !== nextProps.input) return false;
    if (prevProps.isLoading !== nextProps.isLoading) return false;
    if (prevProps.sendMessage !== nextProps.sendMessage) return false;
    if (prevProps.messages.length !== nextProps.messages.length) return false;
    if (prevProps.isGuestMode !== nextProps.isGuestMode) return false;
    if (!equal(prevProps.attachments, nextProps.attachments)) return false;

    return true;
  },
);

function PureAttachmentsButton({
  fileInputRef,
  isLoading,
}: {
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  isLoading: boolean;
}) {
  return (
    <Button
      className="rounded-md rounded-bl-lg p-[7px] h-fit border-border hover:bg-muted"
      onClick={(event) => {
        event.preventDefault();
        fileInputRef.current?.click();
      }}
      disabled={isLoading}
      variant="ghost"
    >
      <PaperclipIcon size={14} />
    </Button>
  );
}

const AttachmentsButton = memo(PureAttachmentsButton);

function PureStopButton({
  stop,
  setMessages,
}: {
  stop: () => void;
  setMessages: Dispatch<SetStateAction<Array<UIMessage>>>;
}) {
  return (
    <Button
      className="rounded-full p-1.5 h-fit border border-border"
      onClick={(event) => {
        event.preventDefault();
        stop();
        setMessages((messages) => sanitizeUIMessages(messages));
      }}
    >
      <StopIcon size={14} />
    </Button>
  );
}

const StopButton = memo(PureStopButton);

function PureSendButton({
  submitForm,
  input,
  uploadQueue,
  canSend,
}: {
  submitForm: () => void;
  input: string;
  uploadQueue: Array<string>;
  canSend: boolean;
}) {
  return (
    <Button
      className="rounded-full p-1.5 h-fit border border-border"
      onClick={(event) => {
        event.preventDefault();
        submitForm();
      }}
      disabled={!canSend || uploadQueue.length > 0}
    >
      <ArrowUpIcon size={14} />
    </Button>
  );
}

const SendButton = memo(PureSendButton, (prevProps, nextProps) => {
  if (prevProps.uploadQueue.length !== nextProps.uploadQueue.length) return false;
  if (prevProps.input !== nextProps.input) return false;
  if (prevProps.canSend !== nextProps.canSend) return false;
  return true;
});
