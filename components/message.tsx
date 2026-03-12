'use client';

import { isToolOrDynamicToolUIPart, type ChatRequestOptions, type UIMessage } from 'ai';
import cx from 'classnames';
import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';

import type { Vote } from '@/lib/db/schema';

import { DocumentToolCall, DocumentToolResult } from './document';
import { PencilEditIcon, SparklesIcon } from './icons';
import { Markdown } from './markdown';
import { MessageActions } from './message-actions';
import { PreviewAttachment } from './preview-attachment';
import { Weather } from './weather';
import {
  cn,
  getDisplayContentFromUIMessage,
  getFilePartsFromUIMessage,
} from '@/lib/utils';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { MessageEditor } from './message-editor';
import { DocumentPreview } from './document-preview';
import { MessageReasoning } from './message-reasoning';
import type { UploadedAttachment } from '@/lib/chat-attachments';

const PurePreviewMessage = ({
  chatId,
  message,
  vote,
  isLoading,
  setMessages,
  sendMessage,
  isReadonly,
}: {
  chatId: string;
  message: UIMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  setMessages: (
    messages: UIMessage[] | ((messages: UIMessage[]) => UIMessage[]),
  ) => void;
  sendMessage: (
    message?: any,
    options?: ChatRequestOptions,
  ) => Promise<void>;
  isReadonly: boolean;
}) => {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const {
    text: messageText,
    reasoning: reasoningText,
    hasStreamingThinkTag,
  } = getDisplayContentFromUIMessage(message);
  const hasReasoningPart = message.parts.some((part) => part.type === 'reasoning');
  const hasActiveReasoningPart = message.parts.some(
    (part) => part.type === 'reasoning' && part.state !== 'done',
  );
  const isActiveAssistantMessage =
    isLoading && message.role === 'assistant' && messageText.length === 0;
  const isReasoningStreaming =
    isLoading &&
    (hasStreamingThinkTag ||
      hasActiveReasoningPart ||
      hasReasoningPart ||
      isActiveAssistantMessage);
  const shouldShowReasoning =
    reasoningText.length > 0 || isReasoningStreaming;
  const fileParts = getFilePartsFromUIMessage(message);
  const toolParts = message.parts.filter(isToolOrDynamicToolUIPart);

  return (
    <AnimatePresence>
      <motion.div
        className="w-full mx-auto max-w-3xl px-4 group/message"
        initial={{ y: 5, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        data-role={message.role}
      >
        <div
          className={cn(
            'flex gap-4 w-full group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl',
            {
              'w-full': mode === 'edit',
              'group-data-[role=user]/message:w-fit': mode !== 'edit',
            },
          )}
        >
          {message.role === 'assistant' && (
            <div className="size-8 flex items-center rounded-full justify-center ring-1 shrink-0 ring-border bg-background">
              <div className="translate-y-px">
                <SparklesIcon size={14} />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-4 w-full">
            {fileParts.length > 0 && (
              <div className="flex flex-row justify-end gap-2">
                {fileParts.map((filePart) => (
                  <PreviewAttachment
                    key={filePart.url}
                    attachment={
                      {
                        url: filePart.url,
                        name: filePart.filename,
                        contentType: filePart.mediaType,
                      } satisfies UploadedAttachment
                    }
                  />
                ))}
              </div>
            )}

            {shouldShowReasoning && (
              <MessageReasoning
                isStreaming={isReasoningStreaming}
                reasoning={reasoningText}
              />
            )}

            {messageText && mode === 'view' && (
              <div className="flex flex-row gap-2 items-start">
                {message.role === 'user' && !isReadonly && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        className="px-2 h-fit rounded-full text-muted-foreground opacity-0 group-hover/message:opacity-100"
                        onClick={() => {
                          setMode('edit');
                        }}
                      >
                        <PencilEditIcon />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Edit message</TooltipContent>
                  </Tooltip>
                )}

                <div
                  className={cn('flex flex-col gap-4', {
                    'bg-primary text-primary-foreground px-3 py-2 rounded-xl':
                      message.role === 'user',
                  })}
                >
                  <Markdown>{messageText}</Markdown>
                </div>
              </div>
            )}

            {message.role === 'user' && messageText && mode === 'edit' && (
              <div className="flex flex-row gap-2 items-start">
                <div className="size-8" />

                <MessageEditor
                  key={message.id}
                  message={message}
                  setMode={setMode}
                  setMessages={setMessages}
                  sendMessage={sendMessage}
                />
              </div>
            )}

            {toolParts.length > 0 && (
              <div className="flex flex-col gap-4">
                {toolParts.map((toolPart) => {
                  const toolName =
                    toolPart.type === 'dynamic-tool'
                      ? toolPart.toolName
                      : toolPart.type.slice('tool-'.length);
                  const toolCallId = toolPart.toolCallId;
                  const toolInput =
                    toolPart.state === 'input-streaming' ||
                    toolPart.state === 'input-available' ||
                    toolPart.state === 'approval-requested' ||
                    toolPart.state === 'approval-responded' ||
                    toolPart.state === 'output-available' ||
                    toolPart.state === 'output-error' ||
                    toolPart.state === 'output-denied'
                      ? toolPart.input
                      : undefined;

                  const isResult = toolPart.state === 'output-available';
                  if (isResult) {
                    const result = toolPart.output;

                    return (
                      <div key={toolCallId}>
                        {toolName === 'getWeather' ? (
                          <Weather weatherAtLocation={result as any} />
                        ) : toolName === 'createDocument' ? (
                          <DocumentPreview
                            isReadonly={isReadonly}
                            result={result as any}
                          />
                        ) : toolName === 'updateDocument' ? (
                          <DocumentToolResult
                            type="update"
                            result={result as any}
                            isReadonly={isReadonly}
                          />
                        ) : toolName === 'requestSuggestions' ? (
                          <DocumentToolResult
                            type="request-suggestions"
                            result={result as any}
                            isReadonly={isReadonly}
                          />
                        ) : (
                          <pre>{JSON.stringify(result, null, 2)}</pre>
                        )}
                      </div>
                    );
                  }
                  return (
                    <div
                      key={toolCallId}
                      className={cx({
                        skeleton: ['getWeather'].includes(toolName),
                      })}
                    >
                      {toolName === 'getWeather' ? (
                        <Weather />
                      ) : toolName === 'createDocument' ? (
                        <DocumentPreview
                          isReadonly={isReadonly}
                          // Old UI expects "args"; tool input is the v6 equivalent.
                          args={toolInput as any}
                        />
                      ) : toolName === 'updateDocument' ? (
                        <DocumentToolCall
                          type="update"
                          args={toolInput as any}
                          isReadonly={isReadonly}
                        />
                      ) : toolName === 'requestSuggestions' ? (
                        <DocumentToolCall
                          type="request-suggestions"
                          args={toolInput as any}
                          isReadonly={isReadonly}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}

            {!isReadonly && (
              <MessageActions
                key={`action-${message.id}`}
                chatId={chatId}
                message={message}
                vote={vote}
                isLoading={isLoading}
              />
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export const PreviewMessage = PurePreviewMessage;
