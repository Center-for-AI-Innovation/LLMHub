import {
  type UIMessage,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  smoothStream,
  stepCountIs,
  streamText,
} from 'ai';

import { auth } from '@/app/(auth)/auth';
import { myProvider } from '@/lib/ai/models';
import { systemPrompt } from '@/lib/ai/prompts';
import {
  deleteChatById,
  getChatById,
  saveChat,
  saveMessages,
} from '@/lib/db/queries';
import { ensureUUID, generateUUID } from '@/lib/utils';

import { generateTitleFromUserMessage } from '../../actions';
import { createDocument } from '@/lib/ai/tools/create-document';
import { updateDocument } from '@/lib/ai/tools/update-document';
import { requestSuggestions } from '@/lib/ai/tools/request-suggestions';
import { getWeather } from '@/lib/ai/tools/get-weather';

export const maxDuration = 60;

function stripDataParts(message: UIMessage): UIMessage {
  return {
    ...message,
    parts: message.parts.filter((part) => !part.type.startsWith('data-')),
  };
}

export async function POST(request: Request) {
  const {
    id,
    messages,
    selectedChatModel,
  }: { id: string; messages: Array<UIMessage>; selectedChatModel: string } =
    await request.json();

  const session = await auth();

  if (!session || !session.user || !session.user.id) {
    return new Response('Unauthorized', { status: 401 });
  }
  const userId = session.user.id;

  const userMessage = messages.filter((message) => message.role === 'user').at(-1);

  if (!userMessage) {
    return new Response('No user message found', { status: 400 });
  }

  const chat = await getChatById({ id });

  if (chat && chat.userId !== userId) {
    return new Response('Unauthorized - You do not have access to this chat', {
      status: 403,
    });
  }

  if (!chat) {
    const title = await generateTitleFromUserMessage({
      message: {
        id: userMessage.id,
        role: userMessage.role,
        parts: userMessage.parts,
      } as any,
    });
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

  const modelMessages = await convertToModelMessages(messages);

  const stream = createUIMessageStream({
    originalMessages: messages,
    // Ensure assistant message IDs are UUIDs so Postgres persistence doesn't fail.
    generateId: generateUUID,
    execute: ({ writer }) => {
      const result = streamText({
        model: myProvider.languageModel(selectedChatModel),
        system: systemPrompt({ selectedChatModel }),
        messages: modelMessages,
        stopWhen: stepCountIs(5),
        activeTools:
          selectedChatModel === 'chat-model-reasoning'
            ? []
            : [
                'getWeather',
                'createDocument',
                'updateDocument',
                'requestSuggestions',
              ],
        experimental_transform: smoothStream({ chunking: 'word' }),
        tools: {
          getWeather,
          createDocument: createDocument({ session, writer }),
          updateDocument: updateDocument({ session, writer }),
          requestSuggestions: requestSuggestions({
            session,
            writer,
          }),
        },
        experimental_telemetry: {
          isEnabled: true,
          functionId: 'stream-text',
        },
      });

      writer.merge(result.toUIMessageStream());
    },
    onError: (error: unknown) => {
      console.error('Chat API error:', error);
      return `Error: ${error instanceof Error ? error.message : 'An unknown error occurred'}`;
    },
    onFinish: async ({ responseMessage }) => {
      try {
        const existingChat = await getChatById({ id });
        if (!existingChat || existingChat.userId !== userId) {
          console.error(
            '[Chat API] Unauthorized attempt to save response to chat:',
            id,
          );
          return;
        }

        const sanitized = stripDataParts(responseMessage);
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
        console.error('Failed to save chat response', error);
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new Response('Not Found', { status: 404 });
  }

  const session = await auth();

  if (!session || !session.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const chat = await getChatById({ id });

    if (chat.userId !== session.user.id) {
      return new Response('Unauthorized', { status: 401 });
    }

    await deleteChatById({ id });

    return new Response('Chat deleted', { status: 200 });
  } catch (error) {
    return new Response('An error occurred while processing your request', {
      status: 500,
    });
  }
}
