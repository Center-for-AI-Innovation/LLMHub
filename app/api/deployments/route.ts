import { auth } from '@/app/(auth)/auth';
import { addUserToDeployment } from '@/lib/db/queries';
import { type NextRequest, NextResponse } from 'next/server';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8000';

const DEFAULT_LAUNCH_RESOURCE_TYPE = 'nvidia_a40';
const DEFAULT_LAUNCH_PARTITION = 'gpuA40x4';
const DEFAULT_LAUNCH_TIME = '00:30:00';

function getDeploymentId(payload: unknown): string | null {
  if (payload && typeof payload === 'object') {
    const directId = (payload as { id?: unknown }).id;
    if (typeof directId === 'string') {
      return directId;
    }

    const nestedId = (payload as { deployment?: { id?: unknown } }).deployment
      ?.id;
    if (typeof nestedId === 'string') {
      return nestedId;
    }
  }

  return null;
}

export async function GET(request: NextRequest) {
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
    const backendUrl = new URL(`${BACKEND_API_URL}/api/models/deployments`);
    backendUrl.searchParams.set('userId', userId);

    const status = url.searchParams.get('status') || undefined;
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
    console.error('Error fetching deployments:', error);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { modelId } = body;

    if (!modelId) {
      return NextResponse.json(
        { error: 'Model ID is required' },
        { status: 400 },
      );
    }

    const response = await fetch(`${BACKEND_API_URL}/api/models/deployments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': userId,
        ...(userEmail ? { 'X-User-Email': userEmail } : {}),
      },
      body: JSON.stringify({
        ...body,
        modelName: body.modelName || modelId,
        modelId,
        userId,
        hf_model: body.hf_model || modelId,
        time: body.time || DEFAULT_LAUNCH_TIME,
        partition: body.partition || DEFAULT_LAUNCH_PARTITION,
        resource_type: body.resource_type || DEFAULT_LAUNCH_RESOURCE_TYPE,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        {
          error:
            errorData.error ||
            errorData.detail ||
            `Failed to launch model: ${response.statusText}`,
        },
        { status: response.status },
      );
    }

    const data = await response.json();
    const deploymentId = getDeploymentId(data);

    if (deploymentId) {
      try {
        await addUserToDeployment({
          deploymentId,
          userId,
          permission: 'owner',
        });
      } catch (error) {
        const errorCode =
          typeof error === 'object' && error !== null && 'code' in error
            ? (error as { code?: string }).code
            : undefined;

        // Ignore duplicates in case the owner row already exists.
        if (errorCode !== '23505') {
          console.error(
            'Error creating authorized users for deployment:',
            error,
          );
          return NextResponse.json(
            { error: 'Failed to create authorized users.' },
            { status: 500 },
          );
        }
      }
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error launching model:', error);
    return NextResponse.json(
      { error: 'Failed to launch model. Backend service may be unavailable.' },
      { status: 503 },
    );
  }
}
