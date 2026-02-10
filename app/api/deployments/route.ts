import { randomInt } from 'crypto';

import { auth } from '@/app/(auth)/auth';
import {
  createModelDeployment,
  getAvailableModelById,
  getAvailableModelByName,
  getModelDeploymentsByUserId,
  getUser,
} from '@/lib/db/queries';
import { type NextRequest, NextResponse } from 'next/server';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8000';

const DEV_ENDPOINT_URL = process.env.DEV_VLLM_ENDPOINT || 'http://localhost:8000/v1';
const DEV_MODEL_NAME = process.env.DEV_VLLM_MODEL_NAME || 'Qwen/Qwen2.5-1.5B-Instruct';
const DEPLOYMENT_LAUNCH_MODE = process.env.DEPLOYMENT_LAUNCH_MODE || 'backend';

const DEFAULT_LAUNCH_RESOURCE_TYPE = 'nvidia_a40';
const DEFAULT_LAUNCH_PARTITION = 'gpuA40x4';
const DEFAULT_LAUNCH_TIME = '00:10:00';

const SLURM_JOB_ID_LENGTH = 6;

const createSlurmJobId = () =>
  randomInt(0, 10 ** SLURM_JOB_ID_LENGTH).toString().padStart(SLURM_JOB_ID_LENGTH, '0');

function isLocalLaunchMode(requestedMode?: unknown) {
  if (requestedMode === 'local') return true;
  if (requestedMode === 'backend' || requestedMode === 'slurm') return false;

  const envMode = DEPLOYMENT_LAUNCH_MODE.toLowerCase();
  return envMode === 'local' || envMode === 'dev';
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
    const mode = url.searchParams.get('mode');

    if (isLocalLaunchMode(mode)) {
      const deployments = await getModelDeploymentsByUserId(userId);
      return NextResponse.json(deployments);
    }

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

    if (isLocalLaunchMode(body?.mode)) {
      const devUserEmail = process.env.DEV_USER_EMAIL;
      let targetUserId = userId;

      if (devUserEmail) {
        const [devUser] = await getUser(devUserEmail);
        if (devUser?.id) {
          targetUserId = devUser.id;
        }
      }

      const [modelById] = await getAvailableModelById({ id: modelId });
      const [modelByName] = modelById
        ? [null]
        : await getAvailableModelByName({ name: DEV_MODEL_NAME });
      const model = modelById || modelByName;

      if (!model) {
        return NextResponse.json(
          { error: `Model ${modelId} is not available.` },
          { status: 404 },
        );
      }

      const deployment = await createModelDeployment({
        modelId: model.id,
        modelName: model.name,
        userId: targetUserId,
        slurmJobId: `test-${createSlurmJobId()}`,
        status: 'running',
        endpointUrl: DEV_ENDPOINT_URL,
        resourceAllocation: { mode: 'local' },
      });

      return NextResponse.json(deployment);
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
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error launching model:', error);
    return NextResponse.json(
      { error: 'Failed to launch model. Backend service may be unavailable.' },
      { status: 503 },
    );
  }
}
