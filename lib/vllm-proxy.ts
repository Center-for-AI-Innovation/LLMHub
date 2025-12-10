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
 * Build the target vLLM URL for proxying
 * 
 * @param deployment - The deployment info
 * @param path - The remaining path after the job ID (e.g., ['chat', 'completions'])
 * @returns The full URL to proxy to
 */
export function buildVllmUrl(deployment: DeploymentInfo, path: string[]): string {
  // Use tunnel URL if available, otherwise use endpoint URL
  const baseUrl = deployment.tunnelUrl || deployment.endpointUrl;
  
  if (!baseUrl) {
    throw new Error('No endpoint URL available for deployment');
  }
  
  // Ensure the base URL doesn't end with /v1 to avoid duplication
  const cleanBaseUrl = baseUrl.replace(/\/v1\/?$/, '');
  
  // Build the path - vLLM expects /v1/... format
  const vllmPath = `/v1/${path.join('/')}`;
  
  return `${cleanBaseUrl}${vllmPath}`;
}

/**
 * Proxy a request to the vLLM server
 * 
 * @param targetUrl - The full URL to proxy to
 * @param request - The original request
 * @returns The proxied response
 */
export async function proxyRequest(targetUrl: string, request: Request): Promise<Response> {
  // Clone the request body for forwarding
  const body = request.method !== 'GET' && request.method !== 'HEAD' 
    ? await request.text() 
    : undefined;
  
  // Build headers to forward (exclude host and other hop-by-hop headers)
  const headersToForward = new Headers();
  const skipHeaders = ['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade'];
  
  request.headers.forEach((value, key) => {
    if (!skipHeaders.includes(key.toLowerCase())) {
      headersToForward.set(key, value);
    }
  });
  
  // Make the proxied request
  const proxyResponse = await fetch(targetUrl, {
    method: request.method,
    headers: headersToForward,
    body: body,
  });
  
  // Build response headers (exclude hop-by-hop headers)
  const responseHeaders = new Headers();
  proxyResponse.headers.forEach((value, key) => {
    if (!skipHeaders.includes(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  });
  
  return new Response(proxyResponse.body, {
    status: proxyResponse.status,
    statusText: proxyResponse.statusText,
    headers: responseHeaders,
  });
}

/**
 * Proxy a streaming request to the vLLM server
 * This is specifically optimized for SSE streaming responses from chat completions
 * 
 * @param targetUrl - The full URL to proxy to
 * @param request - The original request
 * @returns The proxied streaming response
 */
export async function proxyStreamingRequest(targetUrl: string, request: Request): Promise<Response> {
  // Clone the request body for forwarding
  const body = request.method !== 'GET' && request.method !== 'HEAD' 
    ? await request.text() 
    : undefined;
  
  // Parse body to check if streaming is requested
  let isStreaming = false;
  if (body) {
    try {
      const parsed = JSON.parse(body);
      isStreaming = parsed.stream === true;
    } catch {
      // Not JSON, proceed without modification
    }
  }
  
  // Build headers to forward
  const headersToForward = new Headers();
  const skipHeaders = ['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade'];
  
  request.headers.forEach((value, key) => {
    if (!skipHeaders.includes(key.toLowerCase())) {
      headersToForward.set(key, value);
    }
  });
  
  // Ensure content-type is set for JSON requests
  if (body && !headersToForward.has('content-type')) {
    headersToForward.set('content-type', 'application/json');
  }
  
  // Make the proxied request
  const proxyResponse = await fetch(targetUrl, {
    method: request.method,
    headers: headersToForward,
    body: body,
  });
  
  // Build response headers
  const responseHeaders = new Headers();
  proxyResponse.headers.forEach((value, key) => {
    if (!skipHeaders.includes(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  });
  
  // For streaming responses, ensure proper headers are set
  if (isStreaming && proxyResponse.ok) {
    responseHeaders.set('content-type', 'text/event-stream');
    responseHeaders.set('cache-control', 'no-cache');
    responseHeaders.set('connection', 'keep-alive');
  }
  
  return new Response(proxyResponse.body, {
    status: proxyResponse.status,
    statusText: proxyResponse.statusText,
    headers: responseHeaders,
  });
}

/**
 * Check if the path is a streaming endpoint
 * 
 * @param path - The path segments
 * @returns true if the endpoint supports streaming
 */
export function isStreamingEndpoint(path: string[]): boolean {
  const pathStr = path.join('/');
  return pathStr === 'chat/completions' || pathStr === 'completions';
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

