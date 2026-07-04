import { auth } from '@/app/(auth)/auth';
import { searchUsers } from '@/lib/db/queries';
import { type NextRequest, NextResponse } from 'next/server';

// Require a couple of characters before searching and cap the length to limit
// user enumeration and expensive scans. Mirrors the bounds in `searchUsers`.
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;

// Autosuggest endpoint for the share dialog: returns registered users whose
// name or email partially matches `q`. Any authenticated user may search so
// they can share their own deployments; only client-safe fields are returned.
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const sessionUser = session?.user as unknown as
      | { id?: string }
      | undefined;
    const userId = sessionUser?.id;

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawQuery = request.nextUrl.searchParams.get('q')?.trim() ?? '';
    if (rawQuery.length < MIN_QUERY_LENGTH) {
      return NextResponse.json({ users: [] });
    }

    const query = rawQuery.slice(0, MAX_QUERY_LENGTH);
    const users = await searchUsers({ query });
    return NextResponse.json({ users });
  } catch (error) {
    console.error('Error searching users:', error);
    return NextResponse.json(
      { error: 'Failed to search users.' },
      { status: 500 },
    );
  }
}
