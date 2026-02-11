import { auth } from '@/app/(auth)/auth';
import { getActiveModelDeploymentByUserId } from '@/lib/db/queries';
import { NextResponse } from 'next/server';

const VLLM_MODEL = process.env.VLLM_MODEL || 'Qwen/Qwen2.5-1.5B-Instruct';
const ALWAYS_ON_VLLM_MODEL = process.env.ALWAYS_ON_VLLM_MODEL;

interface SessionUser {
  id?: string;
}

interface ModelDeployment {
  modelId?: string;
  modelName?: string;
  status?: string | null;
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

  return {
    id: 'vllm-model',
    name: deployedModelName,
    description: `Active deployment (${status})`,
  };
}

async function getActiveDeploymentOptionForUser(
  sessionUser?: SessionUser,
): Promise<ChatModelOption | null> {
  const userId = sessionUser?.id;

  if (!userId) {
    return null;
  }

  try {
    const deployment = await getActiveModelDeploymentByUserId(userId);
    if (!deployment) {
      return null;
    }

    return deploymentToChatOption(deployment);
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
