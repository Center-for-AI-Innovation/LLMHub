/**
 * Test Deployment API
 * 
 * Returns information about test deployments for debugging purposes.
 * The actual test deployment handling is done in the vllm-proxy.ts module
 * when job IDs start with "test-" prefix.
 * 
 * For development/testing only!
 */

import { NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';

// vLLM configuration for testing
const VLLM_BASE_URL = process.env.VLLM_BASE_URL?.replace(/\/v1\/?$/, '') || 'http://localhost:8000';
const VLLM_MODEL = process.env.VLLM_MODEL || 'Qwen/Qwen2.5-1.5B-Instruct';

/**
 * Generate a random test job ID
 */
function generateTestJobId(): string {
  const randomNum = Math.floor(100000 + Math.random() * 900000);
  return `test-${randomNum}`;
}

/**
 * GET - Get test deployment info
 */
export async function GET() {
  try {
    // Check development mode
    const isDevelopment = process.env.NODE_ENV === 'development';
    if (!isDevelopment) {
      return NextResponse.json(
        { error: 'Test endpoint is only available in development mode' },
        { status: 403 }
      );
    }

    // Verify authentication
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const jobId = generateTestJobId();

    return NextResponse.json({
      deployment: {
        id: `test-deployment-${jobId}`,
        userId,
        slurmJobId: jobId,
        modelName: VLLM_MODEL,
        status: 'ready',
        endpointUrl: VLLM_BASE_URL,
        tunnelUrl: null,
        errorMessage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expirationTime: null,
      },
      info: {
        message: 'This is a test deployment. Job IDs starting with "test-" bypass the backend lookup.',
        vllmBaseUrl: VLLM_BASE_URL,
        vllmModel: VLLM_MODEL,
        proxyEndpoint: `/api/v1/job/${jobId}/chat/completions`,
      },
    });

  } catch (error) {
    console.error('[TEST DEPLOYMENT] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST - Generate a new test job ID
 */
export async function POST() {
  try {
    // Check development mode
    const isDevelopment = process.env.NODE_ENV === 'development';
    if (!isDevelopment) {
      return NextResponse.json(
        { error: 'Test endpoint is only available in development mode' },
        { status: 403 }
      );
    }

    // Verify authentication
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const jobId = generateTestJobId();

    return NextResponse.json({
      jobId,
      proxyEndpoint: `/api/v1/job/${jobId}/chat/completions`,
      message: `Generated new test job ID: ${jobId}`,
    });

  } catch (error) {
    console.error('[TEST DEPLOYMENT] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
