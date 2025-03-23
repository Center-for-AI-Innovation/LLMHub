'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Chat } from '@/components/chat';
import { DataStreamHandler } from '@/components/data-stream-handler';
import { Navbar } from '@/components/navbar';
import { Loader2 } from 'lucide-react';
import { useSession } from '@/hooks/use-chat';

export default function ChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams?.get('query');
  const { data: session, isLoading } = useSession({
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
  
  // Check authentication
  if (isLoading) {
    return (
      <div className="flex flex-col min-h-screen">
        <Navbar />
        <main className="flex-1 overflow-hidden pt-2">
          <div className="flex flex-col items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-2 text-sm text-muted-foreground">Loading chat...</p>
          </div>
        </main>
      </div>
    );
  }
  
  // Redirect to login if not authenticated
  if (!session?.user) {
    router.push('/login');
    return null;
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
        <DataStreamHandler id="new" />
      </main>
    </div>
  );
} 