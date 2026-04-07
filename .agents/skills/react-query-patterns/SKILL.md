---
name: react-query-patterns
description: Enforce consistent TanStack Query usage in React and Next.js codebases, plus matching server API contracts for those queries. Use when adding or refactoring `useQuery` and `useMutation` hooks, session or auth fetching, query keys, cache invalidation, optimistic updates, or Next.js route handlers that serve React Query clients.
---

# React Query Patterns

## Overview

Implement React Query work as a client-server pair. Put cache keys, fetchers, freshness policy, and invalidation in shared hook modules, then make the server routes return stable JSON and status codes that those hooks can safely consume.

## Workflow

1. Find the existing hook for the resource before adding a new query in a component.
2. If none exists, create one hook module that owns:
   - exported query key constants
   - the fetcher or mutation function
   - the `useQuery` or `useMutation` wrapper
   - cache writes and invalidation for that resource
3. Keep page and component files thin. They should render, navigate, and call hooks, not define data policy inline.
4. Treat auth and session data as special: use one shared session hook and one shared sign-out mutation.
5. Update the server route together with the hook when a response shape changes.

## Client Rules

- Export query keys from the hook module and reuse them for `setQueryData`, `invalidateQueries`, and `removeQueries`.
- Keep fetchers out of page and component files unless the query is truly one-off.
- Normalize API responses at the hook boundary so UI components consume typed data, not raw transport shapes.
- Put freshness policy on the shared hook, not on random call sites.
- Use a shared mutation for side effects like sign-out so every caller gets the same cache behavior.
- Use `setQueryData` only when the client knows the new truth immediately; invalidate after mutations when the server remains the source of truth.
- Avoid ad hoc overrides for auth queries. If a caller needs a variant, expose it from the shared hook module.

## Auth Query Rules

- Session and auth hooks must use `cache: 'no-store'` on the fetch.
- Session and auth hooks should default to `staleTime: 0`, `refetchOnMount: 'always'`, `refetchOnWindowFocus: true`, and `refetchOnReconnect: true`.
- Keep logout behavior behind a shared mutation that clears or invalidates the same session query key.
- Never let one logout UI manually manage the cache while another bypasses it.

## Server Route Rules

- Return JSON for success and failure. Do not redirect from API routes.
- Use HTTP status codes that match the failure mode: `401`, `403`, `404`, `409`, `422`, `429`, `5xx`.
- Validate auth in the route handler even if middleware also protects the path.
- Keep response shapes stable. If the route changes shape, update the hook types and mapping in the same change.
- For user-specific or rapidly changing data, prefer no-store semantics and explicit dynamic behavior when the framework requires it.
- Normalize backend or upstream failures into concise machine-readable fields such as `error` or `message`.

## Review Checklist

- Is there exactly one shared hook module for this resource?
- Does the hook own the query key, fetcher, and freshness policy?
- Are cache writes and invalidations reusing the exported query key?
- Are auth/session hooks using aggressive freshness and a shared sign-out path?
- Do the route handlers return JSON with stable success and error shapes?

## References

- Read [references/client-patterns.md](references/client-patterns.md) for client-side hook structure and examples.
- Read [references/server-route-patterns.md](references/server-route-patterns.md) for route-handler conventions that work well with React Query.
