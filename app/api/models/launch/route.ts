import { auth } from '@/app/(auth)/auth';
import { type NextRequest, NextResponse } from 'next/server';

// Backend API URL
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8000';

// Temporary defaults for launch options while the UI only passes `modelId`.
// TODO: Replace these with user-provided inputs in the UI.
const DEFAULT_LAUNCH_TIME = '00:10:00';
const DEFAULT_LAUNCH_PARTITION = 'secondary';
const DEFAULT_LAUNCH_RESOURCE_TYPE = 'A100';

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

    // Call the backend API to launch the model
    const response = await fetch(`${BACKEND_API_URL}/api/models/launch`, {
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
        hf_model: body.hf_model || modelId, // HuggingFace ID (e.g., "Qwen/Qwen3-8B")
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

    // Return the deployment data
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error launching model:', error);
    return NextResponse.json(
      { error: 'Failed to launch model. Backend service may be unavailable.' },
      { status: 503 },
    );
  }
}
