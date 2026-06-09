'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { Chat } from '@/components/chat';
import { Loader2 } from 'lucide-react';
import { useSession } from '@/hooks/use-auth';
import { useChatContents } from '@/hooks/use-chat';
import { usePendingChat } from '@/hooks/use-pending-chat';
import { getLoginPath } from '@/lib/auth/paths';
import { navigateToLogin } from '@/lib/auth/navigation';

export default function Page() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params?.id as string;
  const query = searchParams?.get('query');

  // Snapshot at mount: if a first-message payload is waiting for this id the
  // chat does not exist server-side yet, so we skip the contents fetch and
  // render the composer immediately. Using a ref (not a live selector) keeps
  // this value stable for the lifetime of this page mount so that clearing the
  // store after auto-send does not cause a re-fetch or remount mid-stream.
  const hadPendingOnMount = useRef(!!usePendingChat.getState().pending[id]).current;

  // Redirect 'new' to root chat page
  useEffect(() => {
    if (id === 'new') {
      router.replace(query ? `/chat?query=${encodeURIComponent(query)}` : '/chat');
    }
  }, [id, query, router]);

  // Fetch data with React Query — disabled while a pending first message exists
  // so we don't 404 on a not-yet-created chat row.
  const { data: session, isLoading: isLoadingSession } = useSession();
  const {
    data: chatContents,
    isLoading: isLoadingContents,
    error: contentsError,
  } = useChatContents(id, !hadPendingOnMount);

  // Combined loading state (not applicable when hadPendingOnMount is true)
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
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-background via-primary/5 to-background rounded-xl">
      <main className="flex-1 overflow-hidden rounded-xl">
        {hadPendingOnMount ? (
          // Chat row doesn't exist yet — render an empty composer immediately.
          // ChatInner will auto-send the stashed first message and start streaming.
          <Chat
            id={id}
            initialMessages={[]}
            selectedVisibilityType="private"
            isReadonly={false}
          />
        ) : isLoading ? (
          <div className="flex flex-col items-center justify-center h-full">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="mt-2 text-sm text-muted-foreground">Loading chat...</p>
          </div>
        ) : error || !chatContents ? (
          <div className="flex flex-col items-center justify-center h-full">
            <p className="text-muted-foreground">Error: {error?.message || 'Chat not found'}</p>
          </div>
        ) : (
          <Chat
            id={chatContents.chat.id}
            initialMessages={chatContents.messages}
            initialVotes={chatContents.votes}
            initialDocuments={chatContents.documents}
            selectedVisibilityType={chatContents.chat.visibility}
            isReadonly={session?.user?.id !== chatContents.chat.userId}
          />
        )}
      </main>
    </div>
  );
}
