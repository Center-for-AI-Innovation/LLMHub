import { create } from 'zustand';
import { DEFAULT_CHAT_MODEL } from '@/lib/ai/models';

interface ModelSelectorState {
  selectedModel: string;
  setSelectedModel: (model: string) => void;
}

export const useModelSelector = create<ModelSelectorState>((set: (fn: (state: ModelSelectorState) => Partial<ModelSelectorState>) => void) => ({
  selectedModel: DEFAULT_CHAT_MODEL,
  setSelectedModel: (model: string) => set(() => ({ selectedModel: model })),
})); 