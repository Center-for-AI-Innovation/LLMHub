# API Optimization for Chat Switching

## Problem Description

The chat application was making several redundant API calls when switching between chats:

1. `GET /api/auth/session` - Authentication check
2. `GET /api/chat/[id]` - Fetch chat metadata
3. `GET /api/chat/[id]/messages` - Fetch chat messages
4. `GET /api/vote?chatId=[id]` - Fetch vote data
5. `GET /api/document?id=[documentId]` - Fetch document(s) associated with chat
6. `GET /api/history` - Fetch chat history every time a chat was switched

These API calls were causing:
- Unnecessary network traffic
- Reduced performance
- Higher server load
- Poorer user experience

## Implemented Solutions

### 1. Consolidated Endpoint for Chat Data

**Problem**: Three separate API calls for chat metadata, messages, and votes

**Solution**: Created a new endpoint that combines all data into a single API call

```typescript
// Before: Three separate API calls
const { data: chat } = useChat(id);
const { data: messages } = useChatMessages(id);
const { data: votes } = useSWR<Array<Vote>>(`/api/vote?chatId=${id}`);

// After: One consolidated API call
const { data: chatContents } = useChatContents(id);
// chatContents includes chat, messages, votes, and relevant documents
```

### 2. Implemented Global Document Cache

**Problem**: Documents were being refetched when switching between chats

**Solution**: Created a Zustand store to maintain a global document cache across components

```typescript
// Created a global document cache using Zustand
export const useDocumentCache = create<DocumentCacheState>((set, get) => ({
  documents: {},
  
  addDocuments: (documentId: string, docs: Document[]) => {
    set((state) => ({
      documents: {
        ...state.documents,
        [documentId]: docs
      }
    }));
  },
  
  getDocuments: (documentId: string) => {
    return get().documents[documentId];
  },
  
  clearCache: () => {
    set({ documents: {} });
  }
}));
```

This cache is used in the Artifact component to prevent duplicate document API calls:

```typescript
const shouldFetchDocument = 
  artifact.documentId !== 'init' && 
  artifact.status !== 'streaming' && 
  !cachedDocuments;

// Only make the API call if the document isn't in the cache
const { data: fetchedDocuments } = useSWR<Array<Document>>(
  shouldFetchDocument ? `/api/document?id=${artifact.documentId}` : null,
  fetcher
);
```

### 3. Fixed Unnecessary Chat History Refetching

**Problem**: The chat history was being refetched on every pathname change

**Solution**: Removed the effect in `sidebar-history.tsx` that was invalidating the query on every pathname change

```typescript
// Removed this problematic effect
useEffect(() => {
  // Refetch chat history when pathname changes (e.g. navigating between chats)
  queryClient.invalidateQueries({ queryKey: ['chatHistory'] });
}, [pathname, queryClient]);
```

### 4. Optimized TanStack Query Configuration

**Problem**: Default TanStack Query settings were causing unnecessary refetches

**Solution**: Adjusted query options to reduce refetches

```typescript
// More efficient query settings
export function useChatHistory(enabled: boolean = true) {
  return useQuery({
    queryKey: ['chatHistory'],
    queryFn: async (): Promise<Chat[]> => {
      // Implementation
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false
  });
}
```

### 5. Pre-emptive Document Caching

**Problem**: Documents were being fetched separately even though their IDs were known from messages

**Solution**: Extract document IDs from messages in the combined endpoint and include them in the response

```typescript
export async function getChatWithMessages({ id }: { id: string }) {
  // Get all unique document IDs referenced in messages
  const documentIds = [...new Set(
    messagesData
      .filter(msg => typeof msg.content === 'string' && msg.content.includes('documentId'))
      .map(msg => {
        try {
          const content = msg.content as string;
          const match = content.match(/"documentId":\s*"([^"]+)"/);
          return match ? match[1] : null;
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean) as string[]
  )];
  
  // Fetch documents if there are any unique IDs
  const documentsData = documentIds.length > 0 
    ? await Promise.all(documentIds.map(docId => getDocumentsById({ id: docId })))
    : [];
    
  // Include documents in the response
  return {
    chat: chatData,
    messages: messagesData,
    votes: votesData,
    documents: flattenedDocuments
  };
}
```

## Results

### Before Optimization
- 5-6 API calls when switching between chats
- Redundant document fetching
- Repeated history fetching

### After Optimization
- Reduced to 2 essential API calls:
  1. `GET /api/auth/session` - Required for authentication
  2. `GET /api/chat/[id]/contents` - Single combined API call for chat data

## Key Components Modified

1. **New Files Created**:
   - `/hooks/use-document-cache.ts` - Zustand store for document caching
   - `/app/api/chat/[id]/contents/route.ts` - Combined API endpoint

2. **Modified Files**:
   - `lib/db/queries.ts` - Added `getChatWithMessages` function
   - `hooks/use-chat.ts` - Added `useChatContents` hook with optimized settings
   - `components/sidebar-history.tsx` - Removed unnecessary refetch
   - `components/artifact.tsx` - Updated to use global document cache
   - `components/chat.tsx` - Updated to use document cache and new hooks

## Future Improvements

1. **Implement SSR for Initial Chat Load**: 
   - Use Next.js Server Components to pre-fetch data for the initial chat render

2. **WebSocket for Real-time Updates**:
   - Replace polling with WebSocket connections for real-time chat updates

3. **Optimistic UI Updates**:
   - Implement optimistic updates for votes and messages to reduce perceived latency 