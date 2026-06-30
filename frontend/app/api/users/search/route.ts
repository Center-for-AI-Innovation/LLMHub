import { auth } from '@/app/(auth)/auth';
import { searchUsers } from '@/lib/db/queries';
import { type NextRequest, NextResponse } from 'next/server';

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

    const query = request.nextUrl.searchParams.get('q')?.trim() ?? '';
    if (query.length === 0) {
      return NextResponse.json({ users: [] });
    }

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
