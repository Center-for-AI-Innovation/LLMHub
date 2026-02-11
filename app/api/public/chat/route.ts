import {
  type Message,
  createDataStreamResponse,
  smoothStream,
  streamText,
} from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { auth } from '@/app/(auth)/auth';
import { getChatById, saveChat, saveMessages } from '@/lib/db/queries';

import { systemPrompt } from '@/lib/ai/prompts';
import {
  GUEST_CHAT_COUNT_COOKIE,
  GUEST_CHAT_MAX_MESSAGES,
  getCookieValue,
  getGuestMessageCount,
} from '@/lib/guest-chat';
import {
  createErrorResponse,
  generateUUID,
  getMostRecentUserMessage,
  sanitizeResponseMessages,
} from '@/lib/utils';

export const maxDuration = 60;
const ALWAYS_ON_MODEL = process.env.ALWAYS_ON_VLLM_MODEL;
const ALWAYS_ON_BASE_URL = process.env.ALWAYS_ON_VLLM_BASE_URL;
const ALWAYS_ON_API_KEY = process.env.ALWAYS_ON_VLLM_API_KEY;

function isLikelyAuthenticatedRequest(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;

  const sessionCookieNames = [
    'authjs.session-token',
    '__Secure-authjs.session-token',
    'next-auth.session-token',
    '__Secure-next-auth.session-token',
  ];

  return sessionCookieNames.some(
    (cookieName) => getCookieValue(cookieHeader, cookieName) !== null,
  );
}

function generateFallbackTitleFromMessage(message: Message): string {
  const rawContent =
    typeof message.content === 'string'
      ? message.content
      : JSON.stringify(message.content);

  const normalized = rawContent.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'New Chat';

  const title = normalized.slice(0, 80);
  return title.length < normalized.length ? `${title}...` : title;
}

export async function POST(request: Request) {
  try {
    if (!ALWAYS_ON_MODEL || !ALWAYS_ON_BASE_URL) {
      return createErrorResponse(
        'Always-on model is not configured. Set ALWAYS_ON_VLLM_MODEL and ALWAYS_ON_VLLM_BASE_URL.',
        500,
      );
    }

    const {
      id,
      messages,
      selectedChatModel,
    }: {
      id?: string;
      messages?: Array<Message>;
      selectedChatModel?: string;
    } = await request.json();

    if (!messages?.length) {
      return createErrorResponse('No messages provided', 400);
    }

    const userMessage = getMostRecentUserMessage(messages);
    if (!userMessage) {
      return createErrorResponse('No user message found', 400);
    }

    const session = await auth();
    const userId = session?.user?.id;
    const cookieHeader = request.headers.get('cookie');
    const isLoggedIn = Boolean(userId) || isLikelyAuthenticatedRequest(cookieHeader);

    const safeGuestMessageCount = getGuestMessageCount(cookieHeader);

    if (!isLoggedIn && safeGuestMessageCount >= GUEST_CHAT_MAX_MESSAGES) {
      return createErrorResponse(
        'Guest message limit reached. Please sign in to continue.',
        429,
      );
    }

    if (userId && id) {
      try {
        const existingChat = await getChatById({ id });
        if (!existingChat) {
          const title = generateFallbackTitleFromMessage(userMessage);
          await saveChat({
            id,
            userId,
            title,
            isBrowserChat: true,
          });
        }

        await saveMessages({
          messages: [{ ...userMessage, createdAt: new Date(), chatId: id }],
        });
      } catch (error) {
        console.error('Failed to persist always-on user message:', error);
      }
    }

    const response = createDataStreamResponse({
      execute: (dataStream) => {
        const alwaysOnProvider = createOpenAI({
          baseURL: ALWAYS_ON_BASE_URL,
          apiKey: ALWAYS_ON_API_KEY || 'dummy-key',
        });

        const result = streamText({
          model: alwaysOnProvider(ALWAYS_ON_MODEL),
          system: systemPrompt({
            selectedChatModel: selectedChatModel ?? 'vllm-model',
          }),
          messages,
          maxSteps: 5,
          experimental_transform: smoothStream({ chunking: 'word' }),
          experimental_generateMessageId: generateUUID,
          experimental_telemetry: {
            isEnabled: true,
            functionId: 'public-vllm-stream-text',
          },
          onFinish: async ({ response, reasoning }) => {
            if (!userId || !id) {
              return;
            }

            try {
              const sanitizedResponseMessages = sanitizeResponseMessages({
                messages: response.messages,
                reasoning,
              });

              await saveMessages({
                messages: sanitizedResponseMessages.map((message) => ({
                  id: message.id,
                  chatId: id,
                  role: message.role,
                  content: message.content,
                  createdAt: new Date(),
                })),
              });
            } catch (error) {
              console.error('Failed to save always-on chat response:', error);
            }
          },
        });

        result.mergeIntoDataStream(dataStream, {
          sendReasoning: true,
        });
      },
      onError: (error: unknown) => {
        console.error('Public chat API error:', error);
        return `Error: ${error instanceof Error ? error.message : 'An unknown error occurred'}`;
      },
    });

    if (!isLoggedIn) {
      const nextGuestMessageCount = safeGuestMessageCount + 1;
      response.headers.append(
        'Set-Cookie',
        `${GUEST_CHAT_COUNT_COOKIE}=${nextGuestMessageCount}; Path=/; Max-Age=2592000; SameSite=Lax`,
      );
    }

    return response;
  } catch (error) {
    console.error('Public chat route failed:', error);
    return createErrorResponse('Failed to process chat request', 500);
  }
}
