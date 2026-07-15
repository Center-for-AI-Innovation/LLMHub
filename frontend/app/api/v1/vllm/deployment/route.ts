/**
 * vLLM Job Management API
 * 
 * Route for hook use-vllm-deployment to get user active vLLM deployment
 * Manages vLLM deployment IDs for the authenticated user.
 * Fetches job information from the ModelDeployment table.
 * 
 * GET: Fetch user's active vLLM deployment from ModelDeployment table
 * POST: Refresh/revalidate the deployment info
 */

import { NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { getActiveAccessibleDeploymentByUserId } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET - Get user's active vLLM deployment from ModelDeployment table
 */
export async function GET() {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized', deploymentId: null },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // Get active deployment the user can access (owner/shared)
    try {
      const activeDeployment = await getActiveAccessibleDeploymentByUserId(userId);
      
      if (activeDeployment) {
        // Found an active deployment in ModelDeployment table
        // proxyUrl is built inline using the deployment ID - clients can also use getVllmChatEndpoint from use-vllm-deployment hook
        return NextResponse.json({
          deploymentId: activeDeployment.id,
          slurmJobId: activeDeployment.slurmJobId,
          modelId: activeDeployment.modelId,
          proxyUrl: `/api/v1/deployment/${activeDeployment.id}/chat/completions`,
          endpointUrl: activeDeployment.endpointUrl,
          modelName: activeDeployment.modelName,
          status: activeDeployment.status,
          expiresAt: activeDeployment.expiresAt,
          createdAt: activeDeployment.createdAt,
        });
      }
    } catch (error) {
      // ModelDeployment table might not exist or query failed
      console.error('[vLLM Deployment API] ModelDeployment query failed:', error);
      return NextResponse.json(
        { error: 'Failed to query deployments', deploymentId: null },
        { status: 500 }
      );
    }

    // No active deployment found
    return NextResponse.json({
      deploymentId: null,
      message: 'No active vLLM deployment. Please launch a model first.',
    });

  } catch (error) {
    console.error('[vLLM Deployment API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error', deploymentId: null },
      { status: 500 }
    );
  }
}

/**
 * POST - Refresh/revalidate the deployment info
 * This endpoint forces a fresh fetch from the database
 */
export async function POST() {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized', deploymentId: null },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // Get the latest active deployment the user can access (owner/shared)
    try {
      const activeDeployment = await getActiveAccessibleDeploymentByUserId(userId);
      
      if (activeDeployment) {
        return NextResponse.json({
          slurmJobId: activeDeployment.slurmJobId,
          deploymentId: activeDeployment.id,
          modelId: activeDeployment.modelId,
          proxyUrl: `/api/v1/deployment/${activeDeployment.id}/chat/completions`,
          endpointUrl: activeDeployment.endpointUrl,
          modelName: activeDeployment.modelName,
          status: activeDeployment.status,
          expiresAt: activeDeployment.expiresAt,
          createdAt: activeDeployment.createdAt,
          refreshed: true,
        });
      }
    } catch (error) {
      console.error('[vLLM Deployment API] Failed to refresh deployment:', error);
    }

    return NextResponse.json({
      deploymentId: null,
      message: 'No active vLLM deployment found. Please launch a model first.',
      refreshed: true,
    });

  } catch (error) {
    console.error('[vLLM Deployment API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error', deploymentId: null },
      { status: 500 }
    );
  }
}
