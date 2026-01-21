/**
vLLM Deployments static proxy route. Similar to the app/api/deployments/route.ts route, but uses the vLLM provider instead of the OpenAI provider.

This route is used to proxy deployment requests to the vLLM server.

It is used when the user selects the "vLLM Local" model in the model selector.

NOT YET TESTED.
*/


import { NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { getUserById } from '@/lib/db/queries';

// Backend API URL for vLLM engine
const VLLM_BACKEND_URL = process.env.VLLM_BACKEND_URL || process.env.BACKEND_API_URL || 'http://localhost:8000';

/**
 * vLLM Deployments StaticProxy API Route. Similar to the app/api/deployments/route.ts route, but uses the vLLM provider instead of the OpenAI provider.
 * 
 * This route handles deployment requests and proxies them to the vLLM backend.
 * 
 * Security features:
 * 1. Verifies user is logged in via session
 * 2. Verifies user exists in the database
 * 3. Returns the deployments for the user
 * 
 * NOT TESTED YET.
 */
export async function GET(req: Request) {
  try {
    // Step 1: Verify user is authenticated
    const session = await auth();
    
    if (!session || !session.user || !session.user.id) {
      return NextResponse.json(
        { error: 'Unauthorized - Please log in to continue' },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const userEmail = session.user.email;

    // Step 2: Verify user exists in database
    const dbUser = await getUserById(userId);

    if (!dbUser) {
      return NextResponse.json(
        { error: 'User not found in database' },
        { status: 403 }
      );
    }

    // Step 3: Build the backend URL with user parameters
    const backendUrl = new URL(`${VLLM_BACKEND_URL}/api/models/deployments`);
    backendUrl.searchParams.append('userId', userId);
    backendUrl.searchParams.append('userEmail', userEmail || '');
    
    // Step 4: Proxy request to vLLM backend
    const response = await fetch(backendUrl.toString(), {
      method: 'GET',
      headers: {
        'X-User-Id': userId,
        'X-User-Email': userEmail || '',
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('vLLM backend error:', errorText);
      throw new Error(`Backend API returned ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Ensure we always return an array
    const deploymentsArray = Array.isArray(data) ? data : 
                            (data && typeof data === 'object' && Array.isArray(data.deployments)) ? data.deployments : [];
    
    return NextResponse.json(deploymentsArray);

  } catch (error) {
    console.error('vLLM Deployments Proxy error:', error);
    // Return empty array on error to maintain API contract
    return NextResponse.json([]);
  }
}

/**
 * POST endpoint to create a new deployment
 */
export async function POST(req: Request) {
  try {
    // Verify user is authenticated
    const session = await auth();

    if (!session || !session.user || !session.user.id) {
      return NextResponse.json(
        { error: 'Unauthorized - Please log in to continue' },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const userEmail = session.user.email;

    // Verify user exists in database
    const dbUser = await getUserById(userId);

    if (!dbUser) {
      return NextResponse.json(
        { error: 'User not found in database' },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await req.json();

    // Proxy request to vLLM backend
    const backendUrl = new URL(`${VLLM_BACKEND_URL}/api/models/deployments`);
    
    const response = await fetch(backendUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': userId,
        'X-User-Email': userEmail || '',
      },
      body: JSON.stringify({
        ...body,
        userId,
        userEmail,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('vLLM backend error:', errorText);
      return NextResponse.json(
        { error: `Backend API returned ${response.status}: ${response.statusText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error('vLLM Deployments POST error:', error);
    return NextResponse.json(
      { 
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE endpoint to remove a deployment
 */
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const deploymentId = searchParams.get('deploymentId');

    if (!deploymentId) {
      return NextResponse.json(
        { error: 'Deployment ID is required' },
        { status: 400 }
      );
    }

    // Verify user is authenticated
    const session = await auth();

    if (!session || !session.user || !session.user.id) {
      return NextResponse.json(
        { error: 'Unauthorized - Please log in to continue' },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const userEmail = session.user.email;

    // Verify user exists in database
    const dbUser = await getUserById(userId);

    if (!dbUser) {
      return NextResponse.json(
        { error: 'User not found in database' },
        { status: 403 }
      );
    }

    // Proxy request to vLLM backend
    const backendUrl = new URL(`${VLLM_BACKEND_URL}/api/models/deployments`);
    backendUrl.searchParams.append('deploymentId', deploymentId);
    backendUrl.searchParams.append('userId', userId);
    
    const response = await fetch(backendUrl.toString(), {
      method: 'DELETE',
      headers: {
        'X-User-Id': userId,
        'X-User-Email': userEmail || '',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('vLLM backend error:', errorText);
      return NextResponse.json(
        { error: `Backend API returned ${response.status}: ${response.statusText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error('vLLM Deployments DELETE error:', error);
    return NextResponse.json(
      { 
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

