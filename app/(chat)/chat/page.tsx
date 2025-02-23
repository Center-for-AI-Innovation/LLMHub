'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Chat } from '@/components/chat';
import { DEFAULT_CHAT_MODEL } from '@/lib/ai/models';
import { Navbar } from '@/components/navbar';
import { Message } from 'ai';

export default function ChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.get('query');

  // Create initial message if query exists
  const initialMessages: Message[] = query ? [
    { id: '1', role: 'user' as const, content: query, createdAt: new Date() }
  ] : [];

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <main className="flex-1 overflow-hidden pt-2">
        <Chat
          id="new"
          initialMessages={initialMessages}
          selectedVisibilityType="private"
          isReadonly={false}
        />
      </main>
    </div>
  );
} 