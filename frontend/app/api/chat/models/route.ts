import { auth } from '@/app/(auth)/auth';
import {
  getAccessibleDeploymentsByUserId,
  getAvailableModels,
} from '@/lib/db/queries';
import { isChatModelType } from '@/lib/models/types';
import { NextResponse } from 'next/server';

const ALWAYS_ON_VLLM_MODEL = process.env.ALWAYS_ON_VLLM_MODEL;

interface SessionUser {
  id?: string;
}

interface ModelDeployment {
  id?: string;
  modelId?: string;
  modelName?: string;
  slurmJobId?: string;
  status?: string | null;
  updatedAt?: Date | string | null;
}

interface ChatModelOption {
  id: string;
  name: string;
  description: string;
}

export const dynamic = 'force-dynamic';


function deploymentToChatOption(
  deployment: ModelDeployment,
  deploymentId: string,
): ChatModelOption {
  const deployedModelName =
    deployment.modelName || deployment.modelId || 'unknown-model';
  const status = deployment.status?.toLowerCase() || 'ready';

  return {
    id: `vllm-deployment:${deploymentId}`,
    name: deployedModelName,
    description: `Active deployment (${status})`,
  };
}

function isActiveDeploymentStatus(status?: string | null): boolean {
  return status?.toLowerCase() === 'ready' || status?.toLowerCase() === 'running';
}

function toTimestamp(value?: Date | string | null): number {
  if (!value) {
    return 0;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function getActiveDeploymentOptionsForUser(
  sessionUser?: SessionUser,
): Promise<ChatModelOption[]> {
  const userId = sessionUser?.id;

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
    const activeDeployments = deployments
      .filter((deployment) => isActiveDeploymentStatus(deployment.status))
      .filter((deployment) =>
        isChatModelType(modelTypeById.get(deployment.modelId ?? '')),
      )
      .sort((left, right) => toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt));

    const seenDeploymentIds = new Set<string>();
    const options: ChatModelOption[] = [];

    for (const deployment of activeDeployments) {
      const deploymentId = deployment.id;
      if (!deploymentId || seenDeploymentIds.has(deploymentId)) {
        continue;
      }
      seenDeploymentIds.add(deploymentId);
      options.push(deploymentToChatOption(deployment, deploymentId));
    }

    return options;
  } catch {
    return [];
  }
}

export async function GET() {
  const session = await auth();
  const sessionUser = session?.user as SessionUser | undefined;

  const activeDeploymentOptions =
    await getActiveDeploymentOptionsForUser(sessionUser);
  const alwaysOnOption = ALWAYS_ON_VLLM_MODEL
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
