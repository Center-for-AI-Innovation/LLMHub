'use client';

import { updateChatVisibility } from '@/app/(chat)/actions';
import { VisibilityType } from '@/components/visibility-selector';
import { Chat } from '@/lib/db/schema';
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export function useChatVisibility({
  chatId,
  initialVisibility,
}: {
  chatId: string;
  initialVisibility: VisibilityType;
}) {
  const queryClient = useQueryClient();
  const history = queryClient.getQueryData<Chat[]>(['chatHistory']);

  const { data: localVisibility, refetch: refreshLocalVisibility } = useQuery({
    queryKey: [`${chatId}-visibility`],
    queryFn: () => Promise.resolve(initialVisibility),
    initialData: initialVisibility,
  });

  const visibilityType = useMemo(() => {
    if (!history) return localVisibility;
    const chat = history.find((chat) => chat.id === chatId);
    if (!chat) return 'private';
    return chat.visibility;
  }, [history, chatId, localVisibility]);

  const setVisibilityType = (updatedVisibilityType: VisibilityType) => {
    // Update local visibility state
    queryClient.setQueryData([`${chatId}-visibility`], updatedVisibilityType);

    // Update the chatHistory data in the cache
    queryClient.setQueryData<Chat[]>(['chatHistory'], (oldData) => {
      if (!oldData) return [];
      
      return oldData.map((chat) => {
        if (chat.id === chatId) {
          return {
            ...chat,
            visibility: updatedVisibilityType,
          };
        }
        return chat;
      });
    });

    // Call the server action to update the database
    updateChatVisibility({
      chatId: chatId,
      visibility: updatedVisibilityType,
    });
  };

  return { visibilityType, setVisibilityType };
}
