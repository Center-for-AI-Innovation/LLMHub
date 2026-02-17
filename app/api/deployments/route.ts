import { randomInt } from 'crypto';
import { NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import {
  createModelDeployment,
  getAvailableModelByName,
  getModelDeploymentsByUserId,
  addUserToDeployment,
} from '@/lib/db/queries';

const DEV_ENDPOINT_URL = process.env.DEV_VLLM_ENDPOINT || 'http://localhost:8000/v1';
const DEV_MODEL_NAME = process.env.DEV_VLLM_MODEL_NAME || 'Qwen/Qwen2.5-1.5B-Instruct';
const SLURM_JOB_ID_LENGTH = 6;

const createSlurmJobId = () =>
  randomInt(0, 10 ** SLURM_JOB_ID_LENGTH).toString().padStart(SLURM_JOB_ID_LENGTH, '0');

export async function GET() {
  try {
    // Validate the session to ensure user is authenticated
    const session = await auth();
    
    if (!session || !session.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    const deployments = await getModelDeploymentsByUserId(userId || '');
    return NextResponse.json(deployments);
  } catch (error) {
    console.error('Error fetching deployments:', error);
    // Return empty array on error
    return NextResponse.json([]);
  }
} 

export async function POST() {
  try {
    const session = await auth();

    if (!session || !session.user || !session.user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const isDevelopment = process.env.NODE_ENV === 'development';

    // TODO: When we have the backend ready, we will modify this to use the backend API.
    if (!isDevelopment) {
      return NextResponse.json(
        { error: 'Model deployments are only available in development mode.' },
        { status: 501 }
      );
    }

    const userId = session.user.id;

    const [model] = await getAvailableModelByName({ name: DEV_MODEL_NAME });

    if (!model) {
      return NextResponse.json(
        { error: `Model ${DEV_MODEL_NAME} is not available.` },
        { status: 404 }
      );
    }

    const testSlurmJobId = `test-${createSlurmJobId()}`;

    const deployment = await createModelDeployment({
      modelId: model.id,
      modelName: model.name,
      userId,
      slurmJobId: testSlurmJobId,
      status: 'running',
      endpointUrl: DEV_ENDPOINT_URL,
      proxyUrl: `http://localhost:3000/api/vllm/chat`,  // TODO: Need to update this to vllm/testSlurmJobId proxyUrl
    });

    const authorizedUsers = await addUserToDeployment({
      deploymentId: deployment.id,
      userId,
      permission: 'owner',
    });

    if (!authorizedUsers) {
      return NextResponse.json(
        { error: 'Failed to create authorized users.' },
        { status: 500 }
      );
    }

    return NextResponse.json(deployment);

  } catch (error) {
    console.error('Error creating deployment:', error);
    return NextResponse.json(
      { error: 'Failed to create deployment.' },
      { status: 500 }
    );
  }
}

