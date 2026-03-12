import { randomInt } from 'node:crypto';

import { auth } from '@/app/(auth)/auth';
import {
  addUserToDeployment,
  createModelDeployment,
  getAccessibleDeploymentsByUserId,
  getAvailableModelById,
} from '@/lib/db/queries';
import { isLocalTestEnabled } from '@/lib/utils';
import { type NextRequest, NextResponse } from 'next/server';

const DEV_ENDPOINT_URL =
  process.env.DEV_VLLM_ENDPOINT || 'http://localhost:8000/v1';
const DEV_MODEL_NAME =
  process.env.DEV_VLLM_MODEL_NAME || 'Qwen/Qwen2.5-1.5B-Instruct';
const SLURM_JOB_ID_LENGTH = 6;

const createSlurmJobId = () =>
  randomInt(0, 10 ** SLURM_JOB_ID_LENGTH)
    .toString()
    .padStart(SLURM_JOB_ID_LENGTH, '0');

export async function GET() {
  try {
    if (!isLocalTestEnabled()) {
      return NextResponse.json(
        {
          error:
            'Local test deployments are only available in development mode.',
        },
        { status: 501 },
      );
    }

    const session = await auth();
    const sessionUser = session?.user as unknown as
      | { id?: string; email?: string | null }
      | undefined;
    const userId = sessionUser?.id;

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const deployments = await getAccessibleDeploymentsByUserId(userId);
    return NextResponse.json(deployments);
  } catch (error) {
    console.error('Error fetching local test deployments:', error);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isLocalTestEnabled()) {
      return NextResponse.json(
        {
          error:
            'Local test deployments are only available in development mode.',
        },
        { status: 501 },
      );
    }

    const session = await auth();
    const sessionUser = session?.user as unknown as
      | { id?: string; email?: string | null }
      | undefined;
    const userId = sessionUser?.id;

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

    const modelName = DEV_MODEL_NAME;
    const modelIdForLookup = modelId;
    const [model] = await getAvailableModelById({ id: modelIdForLookup });

    if (!model) {
      return NextResponse.json(
        { error: `Model ${modelName} is not available.` },
        { status: 404 },
      );
    }

    const deployment = await createModelDeployment({
      modelId: model.id,
      modelName,
      userId,
      slurmJobId: `test-${createSlurmJobId()}`,
      status: 'running',
      endpointUrl: DEV_ENDPOINT_URL,
      resourceAllocation: { mode: 'local' },
    });

    const authorizedUser = await addUserToDeployment({
      deploymentId: deployment.id,
      userId,
      permission: 'owner',
    });

    if (!authorizedUser) {
      return NextResponse.json(
        { error: 'Failed to create authorized users.' },
        { status: 500 },
      );
    }

    return NextResponse.json(deployment);
  } catch (error) {
    console.error('Error creating local test deployment:', error);
    return NextResponse.json(
      { error: 'Failed to create local test deployment.' },
      { status: 500 },
    );
  }
}
