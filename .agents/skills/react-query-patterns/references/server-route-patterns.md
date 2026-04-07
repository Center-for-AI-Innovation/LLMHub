# Server Route Patterns

## Goal

Server routes that feed React Query should be predictable transport layers. They should not mix HTML navigation behavior with API semantics.

## Core Rules

- Return JSON on both success and failure.
- Keep the response shape stable.
- Validate auth in the route handler.
- Use status codes that match the failure mode.
- Mark user-specific or volatile fetches as no-store when freshness matters.

## Route Shape

```ts
export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const data = await loadResource(session.user.id);
  return NextResponse.json(data);
}
```

## Error Handling

When proxying another backend, parse the upstream response once and turn it into a short JSON error.

```ts
if (!response.ok) {
  const errorText = await response.text().catch(() => '');
  return NextResponse.json(
    { error: errorText || 'Backend request failed' },
    { status: response.status },
  );
}
```

## What To Avoid

- Redirects from API routes for login or auth failures
- Middleware-only protection with no handler-level auth check
- Route handlers returning different shapes for the same success case
- Client hooks depending on HTML, redirects, or opaque text blobs
