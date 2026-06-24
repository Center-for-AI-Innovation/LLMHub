import { create } from 'zustand';
import type { ChatRequestOptions } from 'ai';

export interface PendingMessage {
  message: Parameters<(message: unknown, options?: ChatRequestOptions) => void>[0];
  options?: ChatRequestOptions;
}

interface PendingChatState {
  pending: Record<string, PendingMessage>;
  set: (chatId: string, value: PendingMessage) => void;
  clear: (chatId: string) => void;
}

export const usePendingChat = create<PendingChatState>((set) => ({
  pending: {},
  set: (chatId, value) =>
    set((state) => ({ pending: { ...state.pending, [chatId]: value } })),
  clear: (chatId) =>
    set((state) => {
      const next = { ...state.pending };
      delete next[chatId];
      return { pending: next };
    }),
}));
