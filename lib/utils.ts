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

export function getTextFromUIMessage(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

export function getReasoningFromUIMessage(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === 'reasoning')
    .map((part) => part.text)
    .join('');
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
