export const CHAT_PREFERRED_MODEL_KEY = 'chat_preferred_model';

export function setPreferredChatModel(modelId: string) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(CHAT_PREFERRED_MODEL_KEY, modelId);
}

export function consumePreferredChatModel(): string | null {
  if (typeof window === 'undefined') return null;
  const value = window.sessionStorage.getItem(CHAT_PREFERRED_MODEL_KEY);
  if (value) {
    window.sessionStorage.removeItem(CHAT_PREFERRED_MODEL_KEY);
  }
  return value;
}
