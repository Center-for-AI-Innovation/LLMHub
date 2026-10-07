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
import { pickChatModel } from '@/lib/chat-model-selection';
import { getLoginPath } from '@/lib/auth/paths';
import { navigateToLogin } from '@/lib/auth/navigation';

export default function ChatPage() {
  const searchParams = useSearchParams();
  const query = searchParams?.get('query');
  const deploymentIdFromUrl = searchParams?.get('deployment') ?? null;
  const { setSelectedModel } = useModelSelector();
  // Select the URL deployment before Chat first renders so the composer
  // shows it immediately; sends still wait for the options fetch below to
  // validate it. Setting the store from an effect would be too late: Chat's
  // first render would still hold the previous model.
  useState(() => {
    if (deploymentIdFromUrl) {
      setSelectedModel(`vllm-deployment:${deploymentIdFromUrl}`);
    }
  });
  const resetVersion = useNewChat((state) => state.resetVersion);
  const [activeChatId, setActiveChatId] = useState('new');
  const {
    data: chatModelOptions = [],
    isFetchedAfterMount,
    isSuccess,
    isError,
  } = useChatModels();
  const hasSelectedModelRef = useRef(false);
  const [isModelResolved, setIsModelResolved] = useState(false);
  const currentPath = searchParams?.toString()
    ? `/chat?${searchParams.toString()}`
    : '/chat';
  const { data: session, isLoading } = useSession();

  const handleGuestLimitReached = () => {
    toast.error('Guest chat limit reached. Please sign in to continue.');
    navigateToLogin(getLoginPath(currentPath));
  };

  // Guests always chat with the hardcoded always-on model, so they never wait
  // on the options fetch.
  const isModelReady = isModelResolved || !session?.user;

  useEffect(() => {
    // Select once, from this mount's successful fetch: a cached list may not yet
    // include a deployment that just became ready, and later refetches must not
    // override a model the user picked by hand.
    if (hasSelectedModelRef.current || !isFetchedAfterMount || !isSuccess) {
      return;
    }
    hasSelectedModelRef.current = true;

    const { modelId, deploymentUnavailable } = pickChatModel(
      chatModelOptions,
      deploymentIdFromUrl,
    );
    if (modelId) {
      setSelectedModel(modelId);
    }
    if (deploymentUnavailable) {
      toast.info(
        "That deployment isn't available. It may have stopped, or you may not have access.",
      );
    }
    // Sends (including the ?query= auto-send) wait for this: the picked model
    // is guaranteed to come from the fetched options.
    setIsModelResolved(true);
  }, [
    chatModelOptions,
    deploymentIdFromUrl,
    isFetchedAfterMount,
    isSuccess,
    setSelectedModel,
  ]);

  // Never block sends forever: when the options fetch fails, fall back to the
  // current selection (default, previous, or URL deployment).
  useEffect(() => {
    if (isError) {
      setIsModelResolved(true);
    }
  }, [isError]);

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
          isModelReady={isModelReady}
          onGuestLimitReached={handleGuestLimitReached}
          initialPrompt={query || undefined}
        />
      </main>
    </div>
  );
}
