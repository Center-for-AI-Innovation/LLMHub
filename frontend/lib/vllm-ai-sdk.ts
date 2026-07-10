/**
 * vLLM AI SDK Integration Module
 * 
 * This module provides AI SDK-specific functionality for vLLM deployments:
 * - Creating dynamic vLLM providers for specific deployments
 * - Handling chat completions with Vercel AI SDK format
 * - Database persistence for chat messages
 * 
 * Separated from vllm-proxy.ts to keep proxy utilities lightweight
 * and AI SDK dependencies isolated.
 */

import { createOpenAI } from '@ai-sdk/openai';
import {
  type UIMessage,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  smoothStream,
  stepCountIs,
  streamText,
} from 'ai';

import { getChatById, saveChat, saveMessages } from '@/lib/db/queries';
import { createErrorResponse, ensureUUID, generateUUID } from '@/lib/utils';
import { systemPrompt } from '@/lib/ai/prompts';
import type { ModelDeployment } from '@/hooks/use-models';

/**
 * Check if the path is a chat completions endpoint
 */
export function isChatCompletionsEndpoint(path: string[]): boolean {
  return path.join('/') === 'chat/completions';
}

/**
 * Check if the request wants AI SDK data stream format
 * Requests with 'x-response-format: ai-sdk' header get Vercel AI SDK format
 * All other requests get standard OpenAI-compatible responses
 */
export function isAiSdkRequest(request: Request): boolean {
  return request.headers.get('x-response-format') === 'ai-sdk';
}

/**
 * Create a dynamic vLLM provider for a specific deployment
 * 
 * @param deployment - The deployment info containing endpoint URLs
 * @returns An OpenAI-compatible provider configured for the deployment
 */
export function createVllmProvider(deployment: ModelDeployment) {
  const baseUrl = deployment.endpointUrl;
  if (!baseUrl) {
    throw new Error('No endpoint URL available for deployment');
  }
  
  // Ensure the base URL ends with /v1
  const cleanBaseUrl = baseUrl.replace(/\/v1\/?$/, '');
  
  return createOpenAI({
    baseURL: `${cleanBaseUrl}/v1`,
    apiKey: 'dummy-key', // vLLM doesn't require API key by default
  });
}

/**
 * Handle chat completions using Vercel AI SDK
 * This ensures compatibility with the useChat hook and persists messages to the database.
 * 
 * @param request - The incoming request
 * @param deployment - The deployment info
 * @param userId - The authenticated user's ID
 * @returns A streaming response in AI SDK data stream format
 */
export async function handleChatCompletions(
  request: Request,
  deployment: ModelDeployment,
  userId: string
): Promise<Response> {
  const body = await request.json();
  const {
    id,
    messages,
  }: {
    id?: string;
    messages: Array<UIMessage>;
  } = body;

  const chatId = id || generateUUID();

  // Get the user message
  const userMessage = messages.filter((message) => message.role === 'user').at(-1);
  if (!userMessage) {
    return createErrorResponse('No user message found', 400);
  }

  // Create or get the chat
  if (id) {
    const existingChat = await getChatById({ id });
    if (!existingChat) {
      // Create new chat
      const rawTitle = userMessage.parts
        .map((part) => (part.type === 'text' ? part.text : ''))
        .join('')
        .trim();

      const title = rawTitle ? rawTitle.slice(0, 80) : 'New Chat';
      await saveChat({ id: chatId, userId, title, isBrowserChat: true });
    } else {
      // Verify the chat belongs to the current user
      if (existingChat.userId !== userId) {
        return createErrorResponse('Unauthorized - You do not have access to this chat', 403);
      }
    }

    // Save the user message
    await saveMessages({
      messages: [
        {
          id: ensureUUID(userMessage.id),
          chatId,
          role: userMessage.role,
          content: userMessage.parts,
          createdAt: new Date(),
        },
      ],
    });
  }

  // Create dynamic provider for this deployment
  const vllmProvider = createVllmProvider(deployment);
  const modelName = deployment.modelName;
  if (!modelName) {
    return createErrorResponse(
      'Deployment ${deployment.id} has no model name configured.',
      500,
    );
  }

  const modelMessages = await convertToModelMessages(messages);
  const stream = createUIMessageStream({
    originalMessages: messages,
    // Ensure assistant message IDs are UUIDs so Postgres persistence doesn't fail.
    generateId: generateUUID,
    execute: ({ writer }) => {
      const result = streamText({
        // vLLM/OpenAI-compatible servers typically implement /v1/chat/completions, not /v1/responses.
        model: vllmProvider.chat(modelName),
        system: systemPrompt({ selectedChatModel: 'vllm-model' }),
        messages: modelMessages,
        stopWhen: stepCountIs(5),
        experimental_transform: smoothStream({ chunking: 'word' }),
        experimental_telemetry: {
          isEnabled: true,
          functionId: 'vllm-job-proxy-stream-text',
        },
      });

      writer.merge(result.toUIMessageStream());
    },
    onError: (error: unknown) => {
      console.error('[vLLM AI SDK] Chat completions error:', error);
      return `Error: ${error instanceof Error ? error.message : 'An unknown error occurred'}`;
    },
    onFinish: async ({ responseMessage }) => {
      if (!id) return;

      try {
        const chat = await getChatById({ id });
        if (!chat || chat.userId !== userId) {
          console.error(
            '[vLLM AI SDK] Unauthorized attempt to save response to chat:',
            id,
          );
          return;
        }

        const sanitized = {
          ...responseMessage,
          parts: responseMessage.parts.filter(
            (part) => !part.type.startsWith('data-'),
          ),
        };

        await saveMessages({
          messages: [
            {
              id: ensureUUID(sanitized.id),
              chatId,
              role: sanitized.role,
              content: sanitized.parts,
              createdAt: new Date(),
            },
          ],
        });
      } catch (error) {
        console.error('[vLLM AI SDK] Failed to save chat response:', {
          error,
          chatId,
          userId,
        });
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
}
