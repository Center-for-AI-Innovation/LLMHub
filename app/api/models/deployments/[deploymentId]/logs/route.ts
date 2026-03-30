import { auth } from '@/app/(auth)/auth';
import { type NextRequest, NextResponse } from 'next/server';

// Backend API URL
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8000';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ deploymentId: string }> },
) {
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

    const { deploymentId } = await params;

    if (!deploymentId) {
      return NextResponse.json(
        { error: 'Deployment ID is required' },
        { status: 400 },
      );
    }

    // Get tail parameter from query string
    const { searchParams } = new URL(request.url);
    const tail = searchParams.get('tail') || '100';

    // Call the backend API to get deployment logs
    const response = await fetch(
      `${BACKEND_API_URL}/api/models/deployments/${deploymentId}/logs?tail=${tail}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
          ...(userEmail ? { 'X-User-Email': userEmail } : {}),
        },
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        {
          error:
            errorData.error ||
            errorData.detail ||
            `Failed to get logs: ${response.statusText}`,
        },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error getting deployment logs:', error);
    return NextResponse.json(
      { error: 'Failed to get logs. Backend service may be unavailable.' },
      { status: 503 },
    );
  }
}
