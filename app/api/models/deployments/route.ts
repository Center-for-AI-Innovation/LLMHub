import { auth } from '@/app/(auth)/auth';
import { NextResponse } from 'next/server';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8000';

export async function GET(request: Request) {
  try {
    const session = await auth();
    const sessionUser = session?.user as unknown as
      | { id?: string; email?: string | null }
      | undefined;
    const userId = sessionUser?.id;
    const userEmail = sessionUser?.email ?? undefined;

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const status = url.searchParams.get('status') || undefined;

    const backendUrl = new URL(`${BACKEND_API_URL}/api/models/deployments`);
    backendUrl.searchParams.set('userId', userId);
    if (status) backendUrl.searchParams.set('status', status);

    const headers = new Headers();
    headers.set('X-User-Id', userId);
    if (userEmail) headers.set('X-User-Email', userEmail);

    const response = await fetch(backendUrl.toString(), {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return NextResponse.json(
        {
          error:
            errorText ||
            `Backend API returned ${response.status}: ${response.statusText}`,
        },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(Array.isArray(data) ? data : []);
  } catch (error) {
    console.error('Error fetching model deployments:', error);
    return NextResponse.json(
      {
        error:
          'Failed to fetch deployments. Backend service may be unavailable.',
      },
      { status: 503 },
    );
  }
}
