import type { FileUIPart, UIMessage } from 'ai';
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

import type { Message as DBMessage, Document } from '@/lib/db/schema';
import type { ModelDeployment } from '@/hooks/use-models';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ApplicationError extends Error {
  info: string;
  status: number;
}

export const fetcher = async (url: string) => {
  const res = await fetch(url);

  if (!res.ok) {
    const error = new Error(
      'An error occurred while fetching the data.',
    ) as ApplicationError;

    error.info = await res.json();
    error.status = res.status;

    throw error;
  }

  return res.json();
};

export function getLocalStorage(key: string) {
  if (typeof window !== 'undefined') {
    return JSON.parse(localStorage.getItem(key) || '[]');
  }
  return [];
}

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUUID(value: string): boolean {
  return UUID_RE.test(value);
}

export function ensureUUID(value: string | undefined | null): string {
  if (typeof value === 'string' && isUUID(value)) return value;
  return generateUUID();
}

export function convertToUIMessages(
  messages: Array<DBMessage>,
): Array<UIMessage> {
  return messages.flatMap((dbMessage) => {
    // Legacy rows may include tool-role messages from older SDK versions.
    // UIMessage does not support role 'tool', so we skip them for rendering.
    if (dbMessage.role === 'tool') return [];

    const parts: UIMessage['parts'] = (() => {
      if (typeof dbMessage.content === 'string') {
        return [{ type: 'text', text: dbMessage.content }];
      }

      if (Array.isArray(dbMessage.content)) {
        // New format: directly stored UIMessage.parts.
        return dbMessage.content as UIMessage['parts'];
      }

      // Unknown/legacy format: render nothing instead of crashing.
      return [];
    })();

    return [
      {
        id: dbMessage.id,
        role: dbMessage.role as UIMessage['role'],
        parts,
      },
    ];
  });
}

type ExtractedThinkSections = {
  visibleText: string;
  reasoningText: string;
  hasStreamingThinkTag: boolean;
};

function extractThinkSections(text: string): ExtractedThinkSections {
  if (!text) {
    return {
      visibleText: '',
      reasoningText: '',
      hasStreamingThinkTag: false,
    };
  }

  const reasoningSegments: string[] = [];
  const visibleSegments: string[] = [];
  let cursor = 0;
  let hasStreamingThinkTag = false;

  const thinkBlockRegex = /<think>([\s\S]*?)(<\/think>|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = thinkBlockRegex.exec(text)) !== null) {
    const [rawMatch, reasoningSegment, closingTag] = match;
    const start = match.index;
    const end = start + rawMatch.length;

    if (start > cursor) {
      visibleSegments.push(text.slice(cursor, start));
    }

    if (reasoningSegment) {
      reasoningSegments.push(reasoningSegment);
    }

    cursor = end;

    if (closingTag !== '</think>') {
      hasStreamingThinkTag = true;
      break;
    }
  }

  if (!hasStreamingThinkTag && cursor < text.length) {
    visibleSegments.push(text.slice(cursor));
  }

  return {
    visibleText: visibleSegments.join('').replace(/<\/think>/gi, '').trim(),
    reasoningText: reasoningSegments
      .join('\n\n')
      .replace(/<\/?think>/gi, '')
      .trim(),
    hasStreamingThinkTag,
  };
}

export type MessageDisplayContent = {
  text: string;
  reasoning: string;
  hasStreamingThinkTag: boolean;
};

export function getDisplayContentFromUIMessage(
  message: UIMessage,
): MessageDisplayContent {
  const textContent = message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');

  const extractedThink =
    message.role === 'assistant'
      ? extractThinkSections(textContent)
      : {
          visibleText: textContent,
          reasoningText: '',
          hasStreamingThinkTag: false,
        };

  const reasoningContent = message.parts
    .filter((part) => part.type === 'reasoning')
    .map((part) => part.text)
    .join('\n\n')
    .trim();

  const reasoning = [reasoningContent, extractedThink.reasoningText]
    .filter((value) => value.length > 0)
    .join('\n\n')
    .trim();

  return {
    text: extractedThink.visibleText,
    reasoning,
    hasStreamingThinkTag: extractedThink.hasStreamingThinkTag,
  };
}

export function getTextFromUIMessage(message: UIMessage): string {
  return getDisplayContentFromUIMessage(message).text;
}

export function getReasoningFromUIMessage(message: UIMessage): string {
  return getDisplayContentFromUIMessage(message).reasoning;
}

export function getFilePartsFromUIMessage(message: UIMessage): Array<FileUIPart> {
  return message.parts.filter((part) => part.type === 'file') as Array<FileUIPart>;
}

export function sanitizeUIMessages(messages: Array<UIMessage>): Array<UIMessage> {
  return messages
    .map((message) => ({
      ...message,
      parts: message.parts.filter((part) => {
        if (part.type === 'text' || part.type === 'reasoning') {
          return part.text.trim().length > 0;
        }
        return true;
      }),
    }))
    .filter((message) => message.parts.length > 0);
}

export function getMostRecentUserMessage(messages: Array<UIMessage>) {
  const userMessages = messages.filter((message) => message.role === 'user');
  return userMessages.at(-1);
}

export function getDocumentTimestampByIndex(
  documents: Array<Document>,
  index: number,
) {
  if (!documents) return new Date();
  if (index > documents.length) return new Date();

  return documents[index].createdAt;
}


/**
 * Validate that a deployment is ready for proxying
 * 
 * @param deployment - The deployment to validate
 * @returns Object with isValid flag and error message if invalid
 */
export function validateDeployment(deployment: ModelDeployment): { isValid: boolean; error?: string } {
  // Accept both 'ready' and 'running' as valid statuses
  if (deployment.status !== 'ready' && deployment.status !== 'running') {
    return {
      isValid: false,
      error: `Deployment is not ready. Current status: ${deployment.status}`,
    };
  }
  
  if (!deployment.endpointUrl) {
    return {
      isValid: false,
      error: 'Deployment endpoint URL is not available',
    };
  }
  
  return { isValid: true };
}


/**
 * Create an error response in JSON format
 * 
 * @param message - Error message
 * @param status - HTTP status code
 * @returns JSON Response
 */
export function createErrorResponse(message: string, status: number): Response {
  return new Response(
    JSON.stringify({
      error: {
        message,
        type: 'proxy_error',
        code: status,
      },
    }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
