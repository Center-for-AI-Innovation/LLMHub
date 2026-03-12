import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UIMessage } from 'ai';
import { convertToUIMessages } from '@/lib/utils';
import type { VisibilityType } from '@/components/visibility-selector';
import type { Chat, Vote, Document } from '@/lib/db/schema';
import type { UseQueryOptions } from '@tanstack/react-query';

// Types for the chat and session data
export interface ChatData {
  id: string;
  userId: string;
  visibility: VisibilityType;
  title: string;
  createdAt: string;
}

export interface SessionData {
  user?: {
    id: string;
    email: string;
    name?: string;
  } | null;
}

// Types for the combined chat contents data
export interface ChatContentsData {
  chat: ChatData;
  messages: UIMessage[];
  votes: Vote[];
  documents: Document[];
}

// Fetch session data
export function useSession(options?: Partial<UseQueryOptions<SessionData, Error, SessionData, ["session"]>>) {
  return useQuery({
    queryKey: ['session'],
    queryFn: async (): Promise<SessionData> => {
      const res = await fetch('/api/auth/session');
      if (!res.ok) {
        throw new Error('Failed to fetch session');
      }
      return res.json();
    },
    ...options
  });
}

// Fetch chat data
export function useChat(id: string) {
  return useQuery({
    queryKey: ['chat', id],
    queryFn: async (): Promise<ChatData> => {
      const res = await fetch(`/api/chat/${id}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch chat: ${res.status}`);
      }
      return res.json();
    },
    enabled: !!id && id !== 'new',
  });
}

// Fetch chat messages
export function useChatMessages(id: string) {
  return useQuery({
    queryKey: ['chat', id, 'messages'],
    queryFn: async (): Promise<UIMessage[]> => {
      const res = await fetch(`/api/chat/${id}/messages`);
      if (!res.ok) {
        throw new Error('Failed to fetch messages');
      }
      const messagesData = await res.json();
      return convertToUIMessages(messagesData);
    },
    enabled: !!id && id !== 'new',
  });
}

// Create new chat
export function useCreateChat() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (data: { title?: string; visibility: string }): Promise<ChatData> => {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      
      if (!res.ok) {
        throw new Error('Failed to create chat');
      }
      
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      queryClient.invalidateQueries({ queryKey: ['chatHistory'] });
      queryClient.setQueryData(['chat', data.id], data);
    },
  });
}

// Update chat
export function useUpdateChat(id: string) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (data: { title?: string; visibility?: string }): Promise<ChatData> => {
      const res = await fetch(`/api/chat/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      
      if (!res.ok) {
        throw new Error('Failed to update chat');
      }
      
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      queryClient.invalidateQueries({ queryKey: ['chatHistory'] });
      queryClient.setQueryData(['chat', id], data);
      
      // Also update the chatContents cache if it exists
      const chatContents = queryClient.getQueryData<ChatContentsData>(['chatContents', id]);
      if (chatContents) {
        queryClient.setQueryData(['chatContents', id], {
          ...chatContents,
          chat: data
        });
      }
    },
  });
}

// Delete chat
export function useDeleteChat() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const res = await fetch(`/api/chat?id=${id}`, {
        method: 'DELETE',
      });
      
      if (!res.ok) {
        throw new Error('Failed to delete chat');
      }
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      queryClient.invalidateQueries({ queryKey: ['chatHistory'] });
      queryClient.removeQueries({ queryKey: ['chat', id] });
      queryClient.removeQueries({ queryKey: ['chatContents', id] });
    },
  });
}

// Fetch all chats
export function useChats() {
  return useQuery({
    queryKey: ['chats'],
    queryFn: async (): Promise<ChatData[]> => {
      const res = await fetch('/api/chat');
      if (!res.ok) {
        throw new Error('Failed to fetch chats');
      }
      return res.json();
    },
  });
}

// Fetch chat history with increased stale time to reduce refetches
export function useChatHistory(enabled = true) {
  return useQuery({
    queryKey: ['chatHistory'],
    queryFn: async (): Promise<Chat[]> => {
      const res = await fetch('/api/history');
      if (!res.ok) {
        throw new Error('Failed to fetch chat history');
      }
      
      const data = await res.json();
      
      // Return the data directly as Chat[] type
      return data;
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
    // Only refetch on window focus if data is stale
    refetchOnWindowFocus: false,
    // Don't refetch on mount (when navigating between pages)
    refetchOnMount: false
  });
}

// Fetch chat, messages and votes in a single request
export function useChatContents(id: string) {
  return useQuery({
    queryKey: ['chatContents', id],
    queryFn: async (): Promise<ChatContentsData> => {
      const res = await fetch(`/api/chat/${id}/contents`);
      if (!res.ok) {
        throw new Error(`Failed to fetch chat contents: ${res.status}`);
      }
      const data = await res.json();
      
      // Convert DB messages to UI Message format
      return {
        chat: data.chat,
        messages: convertToUIMessages(data.messages),
        votes: data.votes,
        documents: data.documents || []
      };
    },
    enabled: !!id && id !== 'new',
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
} 
