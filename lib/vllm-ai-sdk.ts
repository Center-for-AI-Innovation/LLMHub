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
  type Message,
  createDataStreamResponse,
  smoothStream,
  streamText,
} from 'ai';

import { getChatById, saveChat, saveMessages } from '@/lib/db/queries';
import { generateUUID, getMostRecentUserMessage, sanitizeResponseMessages, createErrorResponse } from '@/lib/utils';
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
    messages: Array<Message>;
  } = body;

  const chatId = id || generateUUID();

  // Get the user message
  const userMessage = getMostRecentUserMessage(messages);
  if (!userMessage) {
    return createErrorResponse('No user message found', 400);
  }

  // Create or get the chat
  if (id) {
    const existingChat = await getChatById({ id });
    if (!existingChat) {
      // Create new chat
      const title = typeof userMessage.content === 'string'
        ? userMessage.content.slice(0, 80)
        : 'New Chat';
      await saveChat({ id: chatId, userId, title, isBrowserChat: true });
    } else {
      // Verify the chat belongs to the current user
      if (existingChat.userId !== userId) {
        return createErrorResponse('Unauthorized - You do not have access to this chat', 403);
      }
    }

    // Save the user message
    await saveMessages({
      messages: [{ ...userMessage, createdAt: new Date(), chatId }],
    });
  }

  // Create dynamic provider for this deployment
  const vllmProvider = createVllmProvider(deployment);
  const modelName = deployment.modelName ?? process.env.VLLM_MODEL;

  return createDataStreamResponse({
    execute: (dataStream) => {
      const result = streamText({
        model: vllmProvider(modelName),
        system: systemPrompt({ selectedChatModel: 'vllm-model' }),
        messages,
        maxSteps: 5,
        experimental_transform: smoothStream({ chunking: 'word' }),
        experimental_generateMessageId: generateUUID,
        onFinish: async ({ response, reasoning }) => {
          if (id) {
            try {
              // Verify ownership before saving response messages
              const chat = await getChatById({ id });
              if (!chat || chat.userId !== userId) {
                console.error('[vLLM AI SDK] Unauthorized attempt to save response to chat:', id);
                return;
              }

              const sanitizedResponseMessages = sanitizeResponseMessages({
                messages: response.messages,
                reasoning,
              });

              await saveMessages({
                messages: sanitizedResponseMessages.map((message) => ({
                  id: message.id,
                  chatId,
                  role: message.role,
                  content: message.content,
                  createdAt: new Date(),
                })),
              });
            } catch (error) {
              console.error('[vLLM AI SDK] Failed to save chat response:', {
                error,
                chatId,
                userId,
              });
            }
          }
        },
        experimental_telemetry: {
          isEnabled: true,
          functionId: 'vllm-job-proxy-stream-text',
        },
      });

      result.mergeIntoDataStream(dataStream, {
        sendReasoning: true,
      });
    },
    onError: (error: unknown) => {
      console.error('[vLLM AI SDK] Chat completions error:', error);
      return `Error: ${error instanceof Error ? error.message : 'An unknown error occurred'}`;
    },
  });
}
