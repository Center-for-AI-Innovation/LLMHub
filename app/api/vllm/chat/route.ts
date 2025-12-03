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
import {
  generateUUID,
  getMostRecentUserMessage,
  sanitizeResponseMessages,
} from '@/lib/utils';

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
    }: { id: string; messages: Array<Message>; selectedChatModel?: string } =
      await request.json();

    // Step 1: Verify user is logged in
    const session = await auth();

    if (!session || !session.user || !session.user.id) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized - Please log in to continue' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const userId = session.user.id;

    // Step 2: Verify user exists in database
    const dbUser = await getUserById(userId);

    if (!dbUser) {
      return new Response(
        JSON.stringify({ error: 'User not found in database' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate message content
    const userMessage = getMostRecentUserMessage(messages);

    if (!userMessage) {
      return new Response(
        JSON.stringify({ error: 'No user message found' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Step 3: Check if chat exists and verify ownership
    const existingChat = await getChatById({ id });

    if (existingChat) {
      // Verify the chat belongs to the current user
      if (existingChat.userId !== userId) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized - You do not have access to this chat' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } else {
      // Create new chat for this user - use vLLM to generate title (not OpenAI)
      const title = await generateTitleWithVllm(userMessage);
      await saveChat({ id, userId, title });
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
  } catch (error) {
    console.error('vLLM Proxy error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
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
    return new Response(
      JSON.stringify({ error: 'Chat ID is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Verify user is authenticated
  const session = await auth();

  if (!session || !session.user || !session.user.id) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Get the chat and verify ownership
  const chat = await getChatById({ id: chatId });

  if (!chat) {
    return new Response(
      JSON.stringify({ error: 'Chat not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Only the owner can access the chat
  if (chat.userId !== session.user.id) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized - You do not have access to this chat' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ chat }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

