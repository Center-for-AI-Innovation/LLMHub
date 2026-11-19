import { auth } from '@/app/(auth)/auth';
import {
  getAccessibleDeploymentsByUserId,
  getAvailableModels,
} from '@/lib/db/queries';
import { isChatModelType } from '@/lib/models/types';
import { NextResponse } from 'next/server';

const ALWAYS_ON_VLLM_MODEL = process.env.ALWAYS_ON_VLLM_MODEL;
const ALWAYS_ON_VLLM_BASE_URL = process.env.ALWAYS_ON_VLLM_BASE_URL;

interface ChatModelOption {
  id: string;
  name: string;
  description: string;
}

export const dynamic = 'force-dynamic';

async function getActiveDeploymentOptionsForUser(
  userId?: string,
): Promise<ChatModelOption[]> {
  if (!userId) {
    return [];
  }

  try {
    const [deployments, availableModels] = await Promise.all([
      getAccessibleDeploymentsByUserId(userId),
      getAvailableModels(),
    ]);
    const modelTypeById = new Map(
      availableModels.map((model) => [model.id, model.modelType]),
    );

    return deployments
      .filter(
        (deployment) =>
          (deployment.status === 'ready' || deployment.status === 'running') &&
          isChatModelType(modelTypeById.get(deployment.modelId)),
      )
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .map((deployment) => ({
        id: `vllm-deployment:${deployment.id}`,
        name: deployment.modelName,
        description: `Active deployment (${deployment.status})`,
      }));
  } catch (error) {
    console.error('Failed to load active deployments for chat', error);
    return [];
  }
}

export async function GET() {
  const session = await auth();

  const activeDeploymentOptions = await getActiveDeploymentOptionsForUser(
    session?.user?.id,
  );
  // /api/public/chat needs both the model and the base URL to serve it.
  const alwaysOnOption =
    ALWAYS_ON_VLLM_MODEL && ALWAYS_ON_VLLM_BASE_URL
      ? {
          id: 'always-on-model',
          name: ALWAYS_ON_VLLM_MODEL,
          description: `Always-on model (${ALWAYS_ON_VLLM_MODEL})`,
        }
      : null;

  // Priority order:
  // 1) User's active deployments (ready/running)
  // 2) Always-on model
  const models: ChatModelOption[] = [...activeDeploymentOptions];
  if (alwaysOnOption) {
    models.push(alwaysOnOption);
  }

  return NextResponse.json(models);
}
