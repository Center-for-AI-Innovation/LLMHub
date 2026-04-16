import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { authClient } from '@/lib/auth/client';
import type { AuthUser } from '@/lib/auth/types';
import { useRouter } from 'next/navigation';

export interface SessionData {
  user?: AuthUser | null;
}

export const SESSION_QUERY_KEY = ['session'] as const;

async function fetchSession(): Promise<SessionData> {
  const { data, error } = await authClient.getSession();

  if (error) {
    throw new Error(error.message ?? 'Failed to fetch session');
  }

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
  const router = useRouter();

  return useMutation({
    mutationFn: async () => {
      await authClient.signOut(
        {
          fetchOptions: {
            onSuccess: () => {
              router.push('/');
            },
          },
        }
      );
    },
    onSuccess: async () => {
      queryClient.setQueryData(SESSION_QUERY_KEY, { user: null });
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
  });
}
