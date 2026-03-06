'use client';

import { useEffect } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { Chat } from '@/components/chat';
import { Loader2 } from 'lucide-react';
import { useSession, useChatContents } from '@/hooks/use-chat';
import { getLoginPath } from '@/lib/auth/paths';
import { navigateToLogin } from '@/lib/auth/navigation';

export default function Page() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params?.id as string;
  const query = searchParams?.get('query');
  
  // Redirect 'new' to root chat page
  useEffect(() => {
    if (id === 'new') {
      router.replace(query ? `/chat?query=${encodeURIComponent(query)}` : '/chat');
    }
  }, [id, query, router]);
  
  // Fetch data with React Query
  const { data: session, isLoading: isLoadingSession } = useSession();
  const { 
    data: chatContents, 
    isLoading: isLoadingContents, 
    error: contentsError 
  } = useChatContents(id);
  
  // Combined loading state
  const isLoading = isLoadingSession || isLoadingContents;
  
  // Error state
  const error = contentsError || null;

  // Handle permissions
  useEffect(() => {
    if (!isLoading && chatContents && chatContents.chat.visibility === 'private') {
      if (!session || !session.user) {
        const redirectTo = query
          ? `/chat/${id}?query=${encodeURIComponent(query)}`
          : `/chat/${id}`;
        navigateToLogin(getLoginPath(redirectTo));
        return;
      }
      
      if (session.user.id !== chatContents.chat.userId) {
        router.push('/404');
        return;
      }
    }
  }, [chatContents, id, isLoading, query, router, session]);

  return (
      <div className="flex flex-col min-h-screen  bg-gradient-to-b from-background via-primary/5 to-background rounded-xl">
        <main className="flex-1 overflow-hidden rounded-xl">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="mt-2 text-sm text-muted-foreground">Loading chat...</p>
          </div>
        ) : error || !chatContents ? (
          <div className="flex flex-col items-center justify-center h-full">
            <p className="text-muted-foreground">Error: {error?.message || 'Chat not found'}</p>
          </div>
        ) : (
          <>
            <Chat
              id={chatContents.chat.id}
              initialMessages={chatContents.messages}
              initialVotes={chatContents.votes}
              initialDocuments={chatContents.documents}
              selectedVisibilityType={chatContents.chat.visibility}
              isReadonly={session?.user?.id !== chatContents.chat.userId}
            />
          </>
        )}
      </main>
    </div>
  );
}
