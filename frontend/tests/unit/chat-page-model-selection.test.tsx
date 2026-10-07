// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatPage from '@/app/(chat)/chat/page';
import { useModelSelector } from '@/hooks/use-model-selector';
import { usePendingChat } from '@/hooks/use-pending-chat';

const routerReplace = vi.fn();

const mocks = vi.hoisted(() => ({
  searchParamsString: 'deployment=dep-1',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mocks.searchParamsString),
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
}));
vi.mock('@/hooks/use-auth', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } }, isLoading: false }),
}));
vi.mock('@/hooks/use-vllm-deployment', () => ({
  useVllmDeployment: () => ({ deploymentId: null }),
  getVllmChatEndpoint: (id: string) => `/api/v1/deployment/${id}/chat/completions`,
}));
// Heavy UI that is irrelevant to sending from the composer.
vi.mock('@/components/artifact', () => ({
  Artifact: () => null,
  artifactDefinitions: [],
}));
vi.mock('@/components/messages', () => ({ Messages: () => null }));
vi.mock('@/components/model-selector', () => ({ ModelSelector: () => null }));
vi.mock('@/components/suggested-actions', () => ({
  SuggestedActions: () => null,
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ChatPage />
    </QueryClientProvider>,
  );
}

describe('ChatPage ?deployment= model selection', () => {
  let resolveChatModels: (options: { id: string }[]) => void;
  let rejectChatModels: (reason?: unknown) => void;

  beforeEach(() => {
    // Node's built-in localStorage can shadow jsdom's, so provide our own.
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    useModelSelector.setState({ selectedModel: 'previous-model' });
    mocks.searchParamsString = 'deployment=dep-1';
    const chatModels = new Promise<{ id: string }[]>((resolve, reject) => {
      resolveChatModels = resolve;
      rejectChatModels = reject;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/chat/models') {
          return new Response(JSON.stringify(await chatModels));
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    routerReplace.mockReset();
  });

  it('blocks sends until the options fetch resolves, then sends to the URL deployment', async () => {
    renderPage();
    const textarea = screen.getByPlaceholderText(
      'Loading models...',
    ) as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(routerReplace).not.toHaveBeenCalled();

    await act(async () => {
      resolveChatModels([{ id: 'vllm-deployment:dep-1' }]);
    });

    await waitFor(() => expect(textarea.disabled).toBe(false));

    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // The first logged-in message is stashed and sent from /chat/[id], which
    // reads the model from the store.
    expect(routerReplace).toHaveBeenCalledTimes(1);
    expect(useModelSelector.getState().selectedModel).toBe(
      'vllm-deployment:dep-1',
    );
    const chatId = routerReplace.mock.calls[0][0].replace('/chat/', '');
    expect(usePendingChat.getState().pending[chatId]?.message).toMatchObject({
      text: 'hello',
    });
  });

  it('falls back to the default option when the URL deployment is unavailable', async () => {
    renderPage();

    await act(async () => {
      resolveChatModels([{ id: 'always-on-model' }]);
    });

    await waitFor(() =>
      expect(useModelSelector.getState().selectedModel).toBe('always-on-model'),
    );
  });

  it('holds the ?query= auto-send until the options fetch picks the model', async () => {
    mocks.searchParamsString = 'query=hello';

    renderPage();

    // Before the fetch resolves, the auto-send must not target the stale
    // previous selection.
    await act(async () => {});
    expect(routerReplace).not.toHaveBeenCalled();

    await act(async () => {
      resolveChatModels([{ id: 'vllm-deployment:dep-2' }]);
    });

    await waitFor(() => expect(routerReplace).toHaveBeenCalledTimes(1));
    expect(useModelSelector.getState().selectedModel).toBe(
      'vllm-deployment:dep-2',
    );
    const chatId = routerReplace.mock.calls[0][0].replace('/chat/', '');
    expect(usePendingChat.getState().pending[chatId]?.message).toMatchObject({
      text: 'hello',
    });
  });

  it('lets the ?query= auto-send through with the current selection when the options fetch fails', async () => {
    mocks.searchParamsString = 'query=hello';

    renderPage();

    await act(async () => {
      rejectChatModels(new Error('fetch failed'));
    });

    await waitFor(() => expect(routerReplace).toHaveBeenCalledTimes(1));
    expect(useModelSelector.getState().selectedModel).toBe('previous-model');
    const chatId = routerReplace.mock.calls[0][0].replace('/chat/', '');
    expect(usePendingChat.getState().pending[chatId]?.message).toMatchObject({
      text: 'hello',
    });
  });
});
