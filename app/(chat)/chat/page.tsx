'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Chat } from '@/components/chat';
import { Loader2 } from 'lucide-react';
import { useSession } from '@/hooks/use-auth';
import { toast } from 'sonner';
import { useModelSelector } from '@/hooks/use-model-selector';
import { useChatModels } from '@/hooks/use-models';
import { consumePreferredChatModel } from '@/lib/chat-navigation';
import { useNewChat } from '@/hooks/use-new-chat';
import { getLoginPath } from '@/lib/auth/paths';
import { navigateToLogin } from '@/lib/auth/navigation';

export default function ChatPage() {
  const searchParams = useSearchParams();
  const query = searchParams?.get('query');
  const { setSelectedModel } = useModelSelector();
  const resetVersion = useNewChat((state) => state.resetVersion);
  const [activeChatId, setActiveChatId] = useState('new');
  const { data: chatModelOptions = [] } = useChatModels();
  const preferredModelRef = useRef<string | null>(null);
  const hasInitializedSelectedModelRef = useRef(false);
  const currentPath = searchParams?.toString()
    ? `/chat?${searchParams.toString()}`
    : '/chat';
  const { data: session, isLoading } = useSession();

  const handleGuestLimitReached = () => {
    toast.error('Guest chat limit reached. Please sign in to continue.');
    navigateToLogin(getLoginPath(currentPath));
  };

  useEffect(() => {
    if (chatModelOptions.length === 0) {
      return;
    }

    if (preferredModelRef.current === null) {
      preferredModelRef.current = consumePreferredChatModel();
    }
    const preferredModel = preferredModelRef.current;
    if (preferredModel) {
      const modelExists = chatModelOptions.some(
        (chatModel) => chatModel.id === preferredModel,
      );
      if (modelExists) {
        setSelectedModel(preferredModel);
        preferredModelRef.current = null;
        hasInitializedSelectedModelRef.current = true;
        return;
      }

      preferredModelRef.current = null;
    }

    if (hasInitializedSelectedModelRef.current) {
      return;
    }

    // Default to the first option, which is already prioritized by /api/chat/models:
    // recent deployment -> always-on -> dev model.
    setSelectedModel(chatModelOptions[0].id);
    hasInitializedSelectedModelRef.current = true;
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
      </main>
    </div>
  );
}
