import { notFound } from 'next/navigation';
import { Message } from 'ai';

import { auth } from '@/app/(auth)/auth';
import { Chat } from '@/components/chat';
import { getChatById, getMessagesByChatId } from '@/lib/db/queries';
import { convertToUIMessages } from '@/lib/utils';
import { DataStreamHandler } from '@/components/data-stream-handler';
import { Navbar } from '@/components/navbar';

export default async function Page(props: { 
  params: Promise<{ id: string }>; 
  searchParams: Promise<{ query?: string }> 
}) {
  const [params, searchParams] = await Promise.all([
    props.params,
    props.searchParams
  ]);
  
  const { id } = params;
  const { query } = searchParams;
  
  // Special case for new chat
  if (id === 'new') {
    const session = await auth();
    if (!session?.user) {
      return notFound();
    }

    return (
      <div className="flex flex-col min-h-screen">
        <Navbar />
        <main className="flex-1 overflow-hidden pt-2">
          <Chat
            id="new"
            initialMessages={query ? [{ id: '1', role: 'user' as const, content: query, createdAt: new Date() }] : []}
            selectedVisibilityType="private"
            isReadonly={false}
          />
          <DataStreamHandler id={id} />
        </main>
      </div>
    );
  }
  
  // Only check database for non-new chats
  const chat = await getChatById({ id });

  if (!chat) {
    notFound();
  }

  const session = await auth();

  // Handle visibility checks
  if (chat.visibility === 'private') {
    if (!session || !session.user) {
      return notFound();
    }

    if (session.user.id !== chat.userId) {
      return notFound();
    }
  }

  const messagesFromDb = await getMessagesByChatId({ id });
  const initialMessages = convertToUIMessages(messagesFromDb);

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <main className="flex-1 overflow-hidden pt-2">
        <Chat
          id={chat.id}
          initialMessages={initialMessages}
          selectedVisibilityType={chat.visibility}
          isReadonly={session?.user?.id !== chat.userId}
        />
        <DataStreamHandler id={id} />
      </main>
    </div>
  );
}
