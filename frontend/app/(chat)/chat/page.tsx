'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Chat } from '@/components/chat';
import { Loader2 } from 'lucide-react';
import { useSession } from '@/hooks/use-auth';
import { toast } from 'sonner';
import { useModelSelector } from '@/hooks/use-model-selector';
import { useChatModels } from '@/hooks/use-models';
import { useNewChat } from '@/hooks/use-new-chat';
import {
  resolveChatModelSelection,
  type ChatModelSelectionState,
} from '@/lib/chat-model-selection';
import { getLoginPath } from '@/lib/auth/paths';
import { navigateToLogin } from '@/lib/auth/navigation';

export default function ChatPage() {
  const searchParams = useSearchParams();
  const query = searchParams?.get('query');
  const deploymentIdFromUrl = searchParams?.get('deployment') ?? null;
  const { setSelectedModel } = useModelSelector();
  const resetVersion = useNewChat((state) => state.resetVersion);
  const [activeChatId, setActiveChatId] = useState('new');
  const { data: chatModelOptions = [], isFetchedAfterMount } = useChatModels();
  const selectionStateRef = useRef<ChatModelSelectionState>({
    handledDeploymentId: null,
    initialized: false,
  });
  const currentPath = searchParams?.toString()
    ? `/chat?${searchParams.toString()}`
    : '/chat';
  const { data: session, isLoading } = useSession();

  const handleGuestLimitReached = () => {
    toast.error('Guest chat limit reached. Please sign in to continue.');
    navigateToLogin(getLoginPath(currentPath));
  };

  useEffect(() => {
    const { modelId, state } = resolveChatModelSelection({
      chatModelOptions,
      deploymentIdFromUrl,
      isFetchedAfterMount,
      state: selectionStateRef.current,
    });
    selectionStateRef.current = state;
    if (modelId) {
      setSelectedModel(modelId);
    }
  }, [chatModelOptions, deploymentIdFromUrl, isFetchedAfterMount, setSelectedModel]);

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
      </main>
    </div>
  );
}
