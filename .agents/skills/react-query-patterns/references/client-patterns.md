# Client Patterns

## Standard Hook Shape

Use one module per resource or resource family.

```ts
export const RESOURCE_QUERY_KEY = ['resource'] as const;

async function fetchResource(): Promise<ResourceData> {
  const response = await fetch('/api/resource');
  if (!response.ok) {
    throw new Error('Failed to fetch resource');
  }
  return response.json();
}

export function useResource() {
  return useQuery({
    queryKey: RESOURCE_QUERY_KEY,
    queryFn: fetchResource,
  });
}
```

## Session Pattern

Auth state is different from normal cached content. Use a dedicated auth hook module.

```ts
export const SESSION_QUERY_KEY = ['session'] as const;

async function fetchSession(): Promise<SessionData> {
  const response = await fetch('/api/auth/get-session', {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch session');
  }

  const data = await response.json();
  return { user: data?.user ?? null };
}

export function useSession() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchSession,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}
```

## Mutation Pattern

Put invalidation beside the mutation instead of repeating it in multiple components.

```ts
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
```

## Component Rule

Components should call hooks, not define query policy.

- Good: `const { data } = useSession();`
- Bad: page files passing one-off stale times for the same session query.
- Good: `await signOut.mutateAsync(); router.push('/')`
- Bad: one component invalidating `['session']` manually while another uses a hard reload.
