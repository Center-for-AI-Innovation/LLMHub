import { auth } from '@/app/(auth)/auth';
import { NextResponse } from 'next/server';

const VLLM_MODEL = process.env.VLLM_MODEL || 'Qwen/Qwen2.5-1.5B-Instruct';
const ALWAYS_ON_VLLM_MODEL = process.env.ALWAYS_ON_VLLM_MODEL;
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8000';

interface SessionUser {
  id?: string;
  email?: string | null;
}

interface ModelDeployment {
  modelId?: string;
  modelName?: string;
  status?: string;
  updatedAt?: string;
  createdAt?: string;
}

interface ChatModelOption {
  id: string;
  name: string;
  description: string;
}

export const dynamic = 'force-dynamic';

const ACTIVE_DEPLOYMENT_STATUSES = new Set(['ready', 'running']);

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

  return {
    id: 'vllm-model',
    name: deployedModelName,
    description: `Active deployment (${status})`,
  };
}

function sortDeploymentsByFreshness(
  a: ModelDeployment,
  b: ModelDeployment,
): number {
  const aUpdatedAt = Date.parse(a.updatedAt || '') || 0;
  const bUpdatedAt = Date.parse(b.updatedAt || '') || 0;

  if (bUpdatedAt !== aUpdatedAt) {
    return bUpdatedAt - aUpdatedAt;
  }

  const aCreatedAt = Date.parse(a.createdAt || '') || 0;
  const bCreatedAt = Date.parse(b.createdAt || '') || 0;
  return bCreatedAt - aCreatedAt;
}

async function getActiveDeploymentOptionForUser(
  sessionUser?: SessionUser,
): Promise<ChatModelOption | null> {
  const userId = sessionUser?.id;
  const userEmail = sessionUser?.email ?? undefined;

  if (!userId) {
    return null;
  }

  try {
    const backendUrl = new URL(`${BACKEND_API_URL}/api/models/deployments`);
    backendUrl.searchParams.set('userId', userId);

    const headers = new Headers();
    headers.set('X-User-Id', userId);
    if (userEmail) {
      headers.set('X-User-Email', userEmail);
    }

    const response = await fetch(backendUrl.toString(), {
      method: 'GET',
      headers,
      cache: 'no-store',
    });

    if (!response.ok) {
      return null;
    }

    const deployments = (await response.json()) as ModelDeployment[];
    if (!Array.isArray(deployments)) {
      return null;
    }

    const activeDeployments = deployments
      .filter((deployment) =>
        ACTIVE_DEPLOYMENT_STATUSES.has((deployment.status || '').toLowerCase()),
      )
      .sort(sortDeploymentsByFreshness);

    const latestActiveDeployment = activeDeployments[0];
    if (!latestActiveDeployment) {
      return null;
    }

    return deploymentToChatOption(latestActiveDeployment);
  } catch {
    return null;
  }
}

export async function GET() {
  const session = await auth();
  const sessionUser = session?.user as SessionUser | undefined;

  const activeDeploymentOption =
    await getActiveDeploymentOptionForUser(sessionUser);
  const models: ChatModelOption[] = [
    activeDeploymentOption ?? getDefaultVllmOption(),
  ];

  if (ALWAYS_ON_VLLM_MODEL) {
    models.push({
      id: 'always-on-model',
      name: ALWAYS_ON_VLLM_MODEL,
      description: `Always-on model (${ALWAYS_ON_VLLM_MODEL})`,
    });
  }

  return NextResponse.json(models);
}
