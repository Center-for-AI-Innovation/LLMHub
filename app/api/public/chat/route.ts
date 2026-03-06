import {
  type UIMessage,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  smoothStream,
  stepCountIs,
  streamText,
} from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { auth } from '@/app/(auth)/auth';
import { getChatById, saveChat, saveMessages } from '@/lib/db/queries';

import { systemPrompt } from '@/lib/ai/prompts';
import {
  GUEST_CHAT_COUNT_COOKIE,
  GUEST_CHAT_MAX_MESSAGES,
  getGuestMessageCount,
} from '@/lib/guest-chat';
import { getSessionCookie } from 'better-auth/cookies';
import {
  createErrorResponse,
  ensureUUID,
  generateUUID,
} from '@/lib/utils';

export const maxDuration = 60;
const ALWAYS_ON_MODEL = process.env.ALWAYS_ON_VLLM_MODEL;
const ALWAYS_ON_BASE_URL = process.env.ALWAYS_ON_VLLM_BASE_URL;
const ALWAYS_ON_API_KEY = process.env.ALWAYS_ON_VLLM_API_KEY;

function generateFallbackTitleFromMessage(message: UIMessage): string {
  const rawContent = message.parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')
    .trim();

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
      messages?: Array<UIMessage>;
      selectedChatModel?: string;
    } = await request.json();

    if (!messages?.length) {
      return createErrorResponse('No messages provided', 400);
    }

    const userMessage = messages.filter((message) => message.role === 'user').at(-1);
    if (!userMessage) {
      return createErrorResponse('No user message found', 400);
    }

    const session = await auth();
    const userId = session?.user?.id;
    const cookieHeader = request.headers.get('cookie');
    const isLoggedIn =
      Boolean(userId) || Boolean(getSessionCookie(request.headers));

    const safeGuestMessageCount = getGuestMessageCount(cookieHeader);

    if (!isLoggedIn && safeGuestMessageCount >= GUEST_CHAT_MAX_MESSAGES) {
      return createErrorResponse(
        'Guest message limit reached. Please sign in to continue.',
        429,
      );
    }

    if (userId && id) {
      const existingChat = await getChatById({ id });

      if (existingChat && existingChat.userId !== userId) {
        return createErrorResponse(
          'Unauthorized - You do not have access to this chat',
          403,
        );
      }

      try {
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
          messages: [
            {
              id: ensureUUID(userMessage.id),
              chatId: id,
              role: userMessage.role,
              content: userMessage.parts,
              createdAt: new Date(),
            },
          ],
        });
      } catch (error) {
        console.error('Failed to persist always-on user message:', error);
      }
    }

    const modelMessages = await convertToModelMessages(messages);
    const stream = createUIMessageStream({
      originalMessages: messages,
      // Ensure assistant message IDs are UUIDs so Postgres persistence doesn't fail.
      generateId: generateUUID,
      execute: ({ writer }) => {
        const alwaysOnProvider = createOpenAI({
          baseURL: ALWAYS_ON_BASE_URL,
          apiKey: ALWAYS_ON_API_KEY || 'dummy-key',
        });

        const result = streamText({
          // vLLM/OpenAI-compatible servers typically implement /v1/chat/completions, not /v1/responses.
          model: alwaysOnProvider.chat(ALWAYS_ON_MODEL),
          system: systemPrompt({
            selectedChatModel: selectedChatModel ?? 'vllm-model',
          }),
          messages: modelMessages,
          stopWhen: stepCountIs(5),
          experimental_transform: smoothStream({ chunking: 'word' }),
          experimental_telemetry: {
            isEnabled: true,
            functionId: 'public-vllm-stream-text',
          },
        });

        writer.merge(result.toUIMessageStream());
      },
      onError: (error: unknown) => {
        console.error('Public chat API error:', error);
        return `Error: ${error instanceof Error ? error.message : 'An unknown error occurred'}`;
      },
      onFinish: async ({ responseMessage }) => {
        if (!userId || !id) {
          return;
        }

        try {
          const existingChat = await getChatById({ id });
          if (!existingChat || existingChat.userId !== userId) {
            console.error(
              '[Public Chat] Unauthorized attempt to save response to chat:',
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
                chatId: id,
                role: sanitized.role,
                content: sanitized.parts,
                createdAt: new Date(),
              },
            ],
          });
        } catch (error) {
          console.error('Failed to save always-on chat response:', error);
        }
      },
    });

    const response = createUIMessageStreamResponse({ stream });

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
