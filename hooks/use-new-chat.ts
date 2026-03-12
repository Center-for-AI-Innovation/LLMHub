import { create } from 'zustand';

interface NewChatState {
  resetVersion: number;
  hasDraftMessages: boolean;
  triggerNewChatReset: () => void;
  setHasDraftMessages: (hasDraftMessages: boolean) => void;
}

export const useNewChat = create<NewChatState>((set) => ({
  resetVersion: 0,
  hasDraftMessages: false,
  triggerNewChatReset: () =>
    set((state) => ({
      resetVersion: state.resetVersion + 1,
      hasDraftMessages: false,
    })),
  setHasDraftMessages: (hasDraftMessages) => set(() => ({ hasDraftMessages })),
}));
