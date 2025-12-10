/**
 * vLLM Job Management API
 * 
 * Manages vLLM job IDs for the authenticated user.
 * 
 * GET: Fetch user's active vLLM job from the database
 * POST: Create a new job (test job in development mode)
 * DELETE: Clear/deactivate the user's current job
 */

import { NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import {
  getActiveVllmJobByUserId,
  saveVllmChatJob,
  updateVllmJobStatus,
  saveChat,
  buildProxyUrl,
} from '@/lib/db/queries';
import { generateUUID } from '@/lib/utils';

// vLLM configuration
const VLLM_MODEL = process.env.VLLM_MODEL || 'Qwen/Qwen2.5-1.5B-Instruct';
const VLLM_BASE_URL = process.env.VLLM_BASE_URL?.replace(/\/v1\/?$/, '') || 'http://localhost:8000';

/**
 * Generate a test job ID with "test-" prefix
 */
function generateTestJobId(): string {
  const randomNum = Math.floor(100000 + Math.random() * 900000);
  return `test-${randomNum}`;
}

/**
 * GET - Get user's active vLLM job
 */
export async function GET() {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized', jobId: null },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // Try to get active job from database
    try {
      const activeJob = await getActiveVllmJobByUserId({ userId });
      
      if (activeJob) {
        return NextResponse.json({
          jobId: activeJob.slurmJobId,
          chatId: activeJob.chatId,
          proxyUrl: activeJob.proxyUrl || buildProxyUrl(activeJob.slurmJobId),
          endpointUrl: activeJob.endpointUrl,
          modelName: activeJob.modelName,
          status: activeJob.status,
          isTest: activeJob.slurmJobId.startsWith('test-'),
        });
      }
    } catch (error) {
      // Table might not exist yet, continue to create a test job
      console.log('[vLLM Job API] Database query failed, may need migration:', error);
    }

    // In development mode, auto-create a test job if none exists
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    if (isDevelopment) {
      const jobId = generateTestJobId();
      const chatId = generateUUID();
      
      // Create a chat for this job
      try {
        await saveChat({
          id: chatId,
          userId,
          title: 'vLLM Chat Session',
        });

        const proxyUrl = buildProxyUrl(jobId);
        
        await saveVllmChatJob({
          chatId,
          userId,
          slurmJobId: jobId,
          modelName: VLLM_MODEL,
          endpointUrl: VLLM_BASE_URL,
          proxyUrl,
        });

        return NextResponse.json({
          jobId,
          chatId,
          proxyUrl,
          endpointUrl: VLLM_BASE_URL,
          modelName: VLLM_MODEL,
          status: 'active',
          isTest: true,
        });
      } catch (error) {
        // If database save fails, return job ID anyway for testing
        console.warn('[vLLM Job API] Failed to save job to database:', error);
        return NextResponse.json({
          jobId,
          chatId: null,
          proxyUrl: buildProxyUrl(jobId),
          status: 'active',
          isTest: true,
          warning: 'Job not persisted to database',
        });
      }
    }

    // In production, return null if no active job
    return NextResponse.json({
      jobId: null,
      message: 'No active vLLM deployment. Please launch a model first.',
    });

  } catch (error) {
    console.error('[vLLM Job API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error', jobId: null },
      { status: 500 }
    );
  }
}

/**
 * POST - Create a new vLLM job
 */
export async function POST() {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized', jobId: null },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const isDevelopment = process.env.NODE_ENV === 'development';

    if (!isDevelopment) {
      return NextResponse.json(
        { error: 'Creating test jobs is only available in development mode', jobId: null },
        { status: 403 }
      );
    }

    const jobId = generateTestJobId();
    const chatId = generateUUID();
    const proxyUrl = buildProxyUrl(jobId);

    try {
      // Create a chat for this job
      await saveChat({
        id: chatId,
        userId,
        title: 'vLLM Chat Session',
      });

      await saveVllmChatJob({
        chatId,
        userId,
        slurmJobId: jobId,
        modelName: VLLM_MODEL,
        endpointUrl: VLLM_BASE_URL,
        proxyUrl,
      });
    } catch (error) {
      console.warn('[vLLM Job API] Failed to save job to database:', error);
    }

    return NextResponse.json({
      jobId,
      chatId,
      proxyUrl,
      endpointUrl: VLLM_BASE_URL,
      modelName: VLLM_MODEL,
      status: 'active',
      isTest: true,
    });

  } catch (error) {
    console.error('[vLLM Job API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error', jobId: null },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Deactivate user's current vLLM job
 */
export async function DELETE() {
  try {
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    try {
      const activeJob = await getActiveVllmJobByUserId({ userId });
      
      if (activeJob) {
        await updateVllmJobStatus({
          chatId: activeJob.chatId,
          status: 'inactive',
        });
      }
    } catch (error) {
      console.warn('[vLLM Job API] Failed to deactivate job:', error);
    }

    return NextResponse.json({
      success: true,
      message: 'Job deactivated',
    });

  } catch (error) {
    console.error('[vLLM Job API] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

