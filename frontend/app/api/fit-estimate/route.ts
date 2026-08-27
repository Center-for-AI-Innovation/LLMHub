import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {
  try {
    // The backend endpoint makes outbound HF requests with the server's
    // HF_TOKEN for a caller-supplied model id; require a session like the
    // deployment routes do (the model catalog routes are unauthenticated).
    const session = await auth();
    if (!(session?.user as { id?: string } | undefined)?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    const response = await fetch(`${BACKEND_API_URL}/api/fit-estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            (data as { detail?: string }).detail ||
            (data as { error?: string }).error ||
            `Fit estimate failed (${response.status})`,
        },
        { status: response.status },
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error proxying fit estimate:', error);
    return NextResponse.json(
      { error: 'Fit estimate service unavailable.' },
      { status: 503 },
    );
  }
}
