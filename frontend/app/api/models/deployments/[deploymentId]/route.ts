import { auth } from '@/app/(auth)/auth';
import { getDeploymentAccessForUser } from '../deployment-access-control';
import { NextResponse } from 'next/server';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8000';

export async function GET(
  _request: Request,
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
    const access = await getDeploymentAccessForUser({ deploymentId, userId });

    if (!access.exists) {
      return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    if (!access.canRead) {
      return NextResponse.json(
        { error: 'You do not have access to this deployment.' },
        { status: 403 },
      );
    }

    const headers = new Headers();
    headers.set('X-User-Id', userId);
    if (userEmail) headers.set('X-User-Email', userEmail);

    const response = await fetch(
      `${BACKEND_API_URL}/api/models/deployments/${deploymentId}`,
      {
        method: 'GET',
        headers,
      },
    );

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
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching model deployment:', error);
    return NextResponse.json(
      {
        error:
          'Failed to fetch deployment. Backend service may be unavailable.',
      },
      { status: 503 },
    );
  }
}

export async function DELETE(
  _request: Request,
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
    const access = await getDeploymentAccessForUser({ deploymentId, userId });

    if (!access.exists) {
      return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    if (!access.isOwner) {
      return NextResponse.json(
        { error: 'Only the deployment owner can stop this deployment.' },
        { status: 403 },
      );
    }

    const headers = new Headers();
    headers.set('X-User-Id', userId);
    if (userEmail) headers.set('X-User-Email', userEmail);

    const response = await fetch(
      `${BACKEND_API_URL}/api/models/deployments/${deploymentId}`,
      {
        method: 'DELETE',
        headers,
      },
    );

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

    const data = await response.json().catch(() => null);
    return NextResponse.json(data ?? { success: true });
  } catch (error) {
    console.error('Error stopping model deployment:', error);
    return NextResponse.json(
      {
        error: 'Failed to stop deployment. Backend service may be unavailable.',
      },
      { status: 503 },
    );
  }
}
