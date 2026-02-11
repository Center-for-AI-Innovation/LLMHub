'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Chat } from '@/components/chat';
import { DataStreamHandler } from '@/components/data-stream-handler';
import { Loader2 } from 'lucide-react';
import { useSession } from '@/hooks/use-chat';
import { toast } from 'sonner';
import { useModelSelector } from '@/hooks/use-model-selector';
import { useChatModels } from '@/hooks/use-models';
import { consumePreferredChatModel } from '@/lib/chat-navigation';
import { useNewChat } from '@/hooks/use-new-chat';

export default function ChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams?.get('query');
  const { setSelectedModel } = useModelSelector();
  const resetVersion = useNewChat((state) => state.resetVersion);
  const [activeChatId, setActiveChatId] = useState('new');
  const { data: chatModelOptions = [] } = useChatModels();
  const currentPath = searchParams?.toString()
    ? `/chat?${searchParams.toString()}`
    : '/chat';
  const { data: session, isLoading } = useSession({
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  const handleGuestLimitReached = () => {
    toast.error('Guest chat limit reached. Please sign in to continue.');
    router.push(`/login?redirectTo=${encodeURIComponent(currentPath)}`);
  };

  useEffect(() => {
    const preferredModel = consumePreferredChatModel();
    if (!preferredModel) {
      return;
    }

    const modelExists = chatModelOptions.some(
      (chatModel) => chatModel.id === preferredModel,
    );
    if (modelExists) {
      setSelectedModel(preferredModel);
    }
  }, [chatModelOptions, setSelectedModel]);

  // Check authentication
  if (isLoading) {
    return (
      <div className="flex flex-col min-h-screen bg-gradient-to-b from-background via-primary/5 to-background rounded-xl">
        <main className="flex-1 overflow-hidden pt-2">
          <div className="flex flex-col items-center justify-center h-full">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="mt-2 text-sm text-muted-foreground">
              Loading chat...
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen  bg-gradient-to-b from-background via-primary/5 to-background rounded-xl">
      <main className="flex-1 overflow-hidden rounded-xl">
        <Chat
          resetVersion={resetVersion}
          id="new"
          onResolvedChatId={setActiveChatId}
          initialMessages={[]}
          selectedVisibilityType="private"
          isReadonly={false}
          isGuestMode={!session?.user}
          onGuestLimitReached={handleGuestLimitReached}
          initialPrompt={query || undefined}
        />
        <DataStreamHandler id={activeChatId} />
      </main>
    </div>
  );
}
