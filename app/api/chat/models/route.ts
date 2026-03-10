import { auth } from '@/app/(auth)/auth';
import { getAccessibleDeploymentsByUserId } from '@/lib/db/queries';
import { NextResponse } from 'next/server';

const VLLM_MODEL = process.env.VLLM_MODEL || 'Qwen/Qwen2.5-1.5B-Instruct';
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

function getDefaultVllmOption(): ChatModelOption {
  return {
    id: 'vllm-model',
    name: VLLM_MODEL,
    description: `Deployed vLLM model (${VLLM_MODEL})`,
  };
}

function deploymentToChatOption(deployment: ModelDeployment): ChatModelOption {
  const deployedModelName =
    deployment.modelName || deployment.modelId || VLLM_MODEL;
  const status = deployment.status?.toLowerCase() || 'ready';
  const slurmJobId = deployment.slurmJobId || deployment.id || deployedModelName;

  return {
    id: `vllm-job:${slurmJobId}`,
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
    const deployments = await getAccessibleDeploymentsByUserId(userId);
    const activeDeployments = deployments
      .filter((deployment) => isActiveDeploymentStatus(deployment.status))
      .sort((left, right) => toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt));

    const seenJobIds = new Set<string>();
    const options: ChatModelOption[] = [];

    for (const deployment of activeDeployments) {
      const jobId = deployment.slurmJobId;
      if (!jobId || seenJobIds.has(jobId)) {
        continue;
      }
      seenJobIds.add(jobId);
      options.push(deploymentToChatOption(deployment));
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

  const defaultVllmOption = getDefaultVllmOption();
  const models: ChatModelOption[] = [];

  // Priority order:
  // 1) User's active deployments (ready/running)
  // 2) Always-on model
  // 3) Development/default vLLM model (only when no active and no always-on)
  if (activeDeploymentOptions.length > 0) {
    models.push(...activeDeploymentOptions);
    if (alwaysOnOption) {
      models.push(alwaysOnOption);
    }
  } else if (alwaysOnOption) {
    models.push(alwaysOnOption);
  } else {
    models.push(defaultVllmOption);
  }

  return NextResponse.json(models);
}
