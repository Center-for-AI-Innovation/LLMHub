/**
 * vLLM Proxy Helper Module
 * 
 * This module provides utilities for proxying requests to deployed vLLM instances
 * running on Slurm worker nodes. It handles:
 * - Fetching deployment info by Slurm job ID
 * - Validating endpoint availability
 * - Proxying requests with streaming support
 * - Mapping OpenAI-compatible paths
 */

// Backend API URL for looking up deployments
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8000';

// Test vLLM URL for development
const TEST_VLLM_BASE_URL = process.env.VLLM_BASE_URL?.replace(/\/v1\/?$/, '') || 'http://localhost:8000';

/**
 * Deployment information returned from the backend
 */
export interface DeploymentInfo {
  id: string;
  modelName: string;
  userId: string;
  slurmJobId: string;
  status: 'launching' | 'ready' | 'failed' | 'shutdown';
  endpointUrl: string | null;
  tunnelUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  expirationTime: string | null;
}

/**
 * Check if a job ID is a test/development job ID
 * Test job IDs start with "test-" prefix
 */
export function isTestJobId(jobId: string): boolean {
  return jobId.startsWith('test-');
}

/**
 * Create a mock deployment for testing purposes
 * This is used when the job ID starts with "test-"
 */
export function createTestDeployment(jobId: string, userId: string): DeploymentInfo {
  return {
    id: `test-deployment-${jobId}`,
    modelName: process.env.VLLM_MODEL || 'Qwen/Qwen2.5-1.5B-Instruct',
    userId,
    slurmJobId: jobId,
    status: 'ready',
    endpointUrl: TEST_VLLM_BASE_URL,
    tunnelUrl: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expirationTime: null,
  };
}

/**
 * Fetch deployment information by Slurm job ID
 * 
 * @param jobId - The Slurm job ID
 * @param userId - Optional user ID for test deployments
 * @returns Deployment information or null if not found
 */
export async function getDeploymentByJobId(jobId: string, userId?: string): Promise<DeploymentInfo | null> {
  // Handle test job IDs in development mode
  if (isTestJobId(jobId)) {
    console.log(`[VLLM PROXY] Using test deployment for job ID: ${jobId}`);
    return createTestDeployment(jobId, userId || 'test-user');
  }

  try {
    const response = await fetch(`${BACKEND_API_URL}/api/models/deployments/job/${jobId}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Failed to fetch deployment: ${response.status} ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching deployment by job ID:', error);
    return null;
  }
}

/**
 * Validate that a deployment is ready for proxying
 * 
 * @param deployment - The deployment info to validate
 * @returns Object with isValid flag and error message if invalid
 */
export function validateDeployment(deployment: DeploymentInfo): { isValid: boolean; error?: string } {
  if (deployment.status !== 'ready') {
    return {
      isValid: false,
      error: `Deployment is not ready. Current status: ${deployment.status}`,
    };
  }
  
  if (!deployment.endpointUrl) {
    return {
      isValid: false,
      error: 'Deployment endpoint URL is not available',
    };
  }
  
  return { isValid: true };
}

/**
 * Check if the current user owns the deployment
 * 
 * @param deployment - The deployment info
 * @param userId - The current user's ID
 * @returns true if the user owns the deployment
 */
export function userOwnsDeployment(deployment: DeploymentInfo, userId: string): boolean {
  return deployment.userId === userId;
}


/**
 * Create an error response in JSON format
 * 
 * @param message - Error message
 * @param status - HTTP status code
 * @returns JSON Response
 */
export function createErrorResponse(message: string, status: number): Response {
  return new Response(
    JSON.stringify({
      error: {
        message,
        type: 'proxy_error',
        code: status,
      },
    }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

