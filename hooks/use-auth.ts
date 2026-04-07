import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { authClient } from '@/lib/auth/client';
import type { AuthUser } from '@/lib/auth/types';

export interface SessionData {
  user?: AuthUser | null;
}

export const SESSION_QUERY_KEY = ['session'] as const;

async function fetchSession(): Promise<SessionData> {
  const response = await fetch('/api/auth/get-session', {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch session');
  }

  const data = await response.json();

  return {
    user: data?.user ?? null,
  };
}

export function useSession() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchSession,
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 1,
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await authClient.signOut();
    },
    onSuccess: async () => {
      queryClient.setQueryData(SESSION_QUERY_KEY, { user: null });
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
  });
}
