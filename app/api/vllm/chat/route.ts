/**
vLLM Chat static proxy route. Similar to the app/(chat)/api/chat/route.ts route, but uses the vLLM provider instead of the OpenAI provider.

This route is used to proxy chat requests to the vLLM server.

It is used when the user selects the "vLLM Local" model in the model selector.
*/

import {
  type Message,
  createDataStreamResponse,
  generateText,
  smoothStream,
  streamText,
} from 'ai';

import { auth } from '@/app/(auth)/auth';
import { vllmProvider, VLLM_MODEL } from '@/lib/ai/models';
import { systemPrompt } from '@/lib/ai/prompts';
import {
  getChatById,
  getUserById,
  saveChat,
  saveMessages,
} from '@/lib/db/queries';
import { extractBearerApiKey, getUserFromApiKey } from '@/lib/security/api-keys';
import {
  createErrorResponse,
  generateUUID,
  getMostRecentUserMessage,
  sanitizeResponseMessages,
} from '@/lib/utils';
import { isAiSdkRequest } from '@/lib/vllm-ai-sdk';

export const maxDuration = 60;

/**
 * Generate a simple title from the user's message
 * Uses vLLM instead of OpenAI to generate the title
 */
async function generateTitleWithVllm(message: Message): Promise<string> {
  try {
    const { text: title } = await generateText({
      model: vllmProvider(VLLM_MODEL),
      system: `You will generate a short title based on the first message a user begins a conversation with.
- Ensure it is not more than 80 characters long
- The title should be a summary of the user's message
- Do not use quotes or colons
- Respond with ONLY the title, nothing else`,
      prompt: typeof message.content === 'string' 
        ? message.content 
        : JSON.stringify(message.content),
      maxTokens: 50,
    });
    return title.trim() || 'New Chat';
  } catch (error) {
    console.error('Failed to generate title with vLLM, using fallback:', error);
    // Fallback: extract first few words from the message
    const content = typeof message.content === 'string' 
      ? message.content 
      : 'New Chat';
    const words = content.split(/\s+/).slice(0, 6).join(' ');
    return words.length > 80 ? words.substring(0, 77) + '...' : words || 'New Chat';
  }
}

/**
 * vLLM Proxy API Route
 * 
 * This route handles chat requests and proxies them to a local vLLM server.
 * 
 * Security features:
 * 1. Verifies user is logged in via session
 * 2. Verifies user exists in the database
 * 3. Creates/stores chat in database associated with user
 * 4. Only the user who created the chat can access responses
 */
export async function POST(request: Request) {
  try {
    const {
      id,
      messages,
      selectedChatModel,
    }: { 
      id?: string; 
      messages: Array<Message>; 
      selectedChatModel?: string;
    } = await request.json();

    const isBrowserRequest = isAiSdkRequest(request);

    if (isBrowserRequest) {
      // Step 1: Verify user is logged in
      const session = await auth();

      if (!session || !session.user || !session.user.id) {
        return createErrorResponse(
          'Unauthorized - Please log in to continue',
          401,
        );
      }

      const userId = session.user.id;

      // Step 2: Verify user exists in database
      const dbUser = await getUserById(userId);

      if (!dbUser) {
        return createErrorResponse('User not found in database', 403);
      }

      // Validate message content
      const userMessage = getMostRecentUserMessage(messages);

      if (!userMessage) {
        return createErrorResponse('No user message found', 400);
      }

      if (!id) {
        return createErrorResponse('Chat ID is required', 400);
      }

      // Step 3: Check if chat exists and verify ownership
      const existingChat = await getChatById({ id });

      if (existingChat) {
        // Verify the chat belongs to the current user
        if (existingChat.userId !== userId) {
          return createErrorResponse(
            'Unauthorized - You do not have access to this chat',
            403,
          );
        }
      } else {
        // Create new chat for this user - use vLLM to generate title
        const title = await generateTitleWithVllm(userMessage);
        await saveChat({ id, userId, title, isBrowserChat: true });
      }

      // Save the user message to the database
      await saveMessages({
        messages: [{ ...userMessage, createdAt: new Date(), chatId: id }],
      });

      // Step 4: Proxy request to vLLM and stream response
      return createDataStreamResponse({
        execute: (dataStream) => {
          const result = streamText({
            // Use vLLM provider with the actual model name
            // VLLM_MODEL contains the actual model name like 'Qwen/Qwen2.5-1.5B-Instruct'
            model: vllmProvider(VLLM_MODEL),
            system: systemPrompt({ selectedChatModel: 'vllm-model' }),
            messages,
            maxSteps: 5,
            experimental_transform: smoothStream({ chunking: 'word' }),
            experimental_generateMessageId: generateUUID,
            onFinish: async ({ response, reasoning }) => {
              // Only save messages for the authenticated user
              if (session.user?.id) {
                try {
                  // Verify ownership before saving response messages
                  const chat = await getChatById({ id });
                  if (!chat || chat.userId !== userId) {
                    console.error('[vLLM Chat] Unauthorized attempt to save response to chat:', id);
                    return;
                  }

                  const sanitizedResponseMessages = sanitizeResponseMessages({
                    messages: response.messages,
                    reasoning,
                  });

                  await saveMessages({
                    messages: sanitizedResponseMessages.map((message) => {
                      return {
                        id: message.id,
                        chatId: id,
                        role: message.role,
                        content: message.content,
                        createdAt: new Date(),
                      };
                    }),
                  });
                } catch (error) {
                  console.error('Failed to save vLLM chat response:', error);
                }
              }
            },
            experimental_telemetry: {
              isEnabled: true,
              functionId: 'vllm-stream-text',
            },
          });

          result.mergeIntoDataStream(dataStream, {
            sendReasoning: true,
          });
        },
        onError: (error: unknown) => {
          console.error('vLLM Proxy API error:', error);
          return `Error: ${error instanceof Error ? error.message : 'An unknown error occurred while connecting to vLLM'}`;
        },
      });
    }

    const apiKey = extractBearerApiKey(request.headers.get('authorization'));
    if (!apiKey) {
      return createErrorResponse('Unauthorized - API key is required', 401);
    }

    const apiUser = await getUserFromApiKey(apiKey);
    if (!apiUser) {
      return createErrorResponse('Unauthorized - Invalid API key', 401);
    }

    const userId = apiUser.id;

    // Validate message content
    const userMessage = getMostRecentUserMessage(messages);

    if (!userMessage) {
      return createErrorResponse('No user message found', 400);
    }

    const chatId = id || generateUUID();

    // Step 3: Check if chat exists and verify ownership
    const existingChat = await getChatById({ id: chatId });

    if (existingChat) {

      // Verify chat is not a browser chat
      if (existingChat.isBrowserChat) {
        return createErrorResponse('Unauthorized - Browser chats can not be used for API requests', 403);
      }

      // Verify the chat belongs to the current user
      if (existingChat.userId !== userId) {
        return createErrorResponse('Unauthorized - You do not have access to this chat', 403);
      }
    } else {
      // Create new chat for this user - use vLLM to generate title
      const title = await generateTitleWithVllm(userMessage);
      await saveChat({ id: chatId, userId, title, isBrowserChat: false });
    }

    // Save the user message to the database
    await saveMessages({
      messages: [{ ...userMessage, createdAt: new Date(), chatId }],
    });

    const { text, finishReason, usage, response, reasoning } = await generateText({
      model: vllmProvider(VLLM_MODEL),
      system: systemPrompt({ selectedChatModel: selectedChatModel ?? 'vllm-model' }),
      messages,
      maxSteps: 5,
      experimental_generateMessageId: generateUUID,
    });

    const responseMessages =
      response.messages as Array<(typeof response.messages)[number] & { id: string }>;

    const sanitizedResponseMessages = sanitizeResponseMessages({
      messages: responseMessages,
      reasoning,
    });

    await saveMessages({
      messages: sanitizedResponseMessages.map((message) => {
        return {
          id: message.id,
          chatId,
          role: message.role,
          content: message.content,
          createdAt: new Date(),
        };
      }),
    });

    // Get message ids from response messages
    const messageId = responseMessages[0]?.id;

    return new Response(
      JSON.stringify({
        id: messageId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: VLLM_MODEL,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: text,
            },
            finish_reason: finishReason,
          },
        ],
        usage: {
          prompt_tokens: usage.promptTokens,
          completion_tokens: usage.completionTokens,
          total_tokens: usage.totalTokens,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('vLLM Proxy error:', error);
    return createErrorResponse('Internal server error', 500);
  }
}

/**
 * GET endpoint to retrieve chat history
 * Only the owner of the chat can access it
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get('chatId');

  if (!chatId) {
    return createErrorResponse('Chat ID is required', 400);
  }

  // Verify user is authenticated
  const session = await auth();

  if (!session || !session.user || !session.user.id) {
    return createErrorResponse('Unauthorized', 401);
  }

  // Get the chat and verify ownership
  const chat = await getChatById({ id: chatId });

  if (!chat) {
    return createErrorResponse('Chat not found', 404);
  }

  // Only the owner can access the chat
  if (chat.userId !== session.user.id) {
    return createErrorResponse('Unauthorized - You do not have access to this chat', 403);
  }

  return new Response(
    JSON.stringify({ chat }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

