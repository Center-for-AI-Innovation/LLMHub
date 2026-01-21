/**
vLLM Model Requests static proxy route. Similar to the app/api/model-request/route.ts route, but uses the vLLM provider instead of the OpenAI provider.

This route is used to proxy model request submissions to the vLLM server.

It is used when the user selects the "vLLM Local" model in the model selector.

NOT YET TESTED.
*/

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/app/(auth)/auth';
import { getUserById } from '@/lib/db/queries';

// Backend API URL for vLLM engine
const VLLM_BACKEND_URL = process.env.VLLM_BACKEND_URL || process.env.BACKEND_API_URL || 'http://localhost:8000';

const modelRequestSchema = z.object({
  name: z.string().min(2),
  email: z.string().email().endsWith('illinois.edu'),
  department: z.string().min(2),
  modelType: z.enum(['custom', 'finetuned', 'existing']),
  purpose: z.string().min(50),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  resourceRequirements: z.string().optional(),
});

/**
 * vLLM Model Request Proxy API Route
 * 
 * This route handles model request submissions and proxies them to the vLLM backend.
 * 
 * Security features:
 * 1. Verifies user is logged in via session
 * 2. Verifies user exists in the database
 * 3. Validates request payload with Zod schema
 * 4. Proxies authenticated requests to backend
 */
export async function POST(req: Request) {
  try {
    // Step 1: Verify user is logged in
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

    // Step 3: Parse and validate request body
    const json = await req.json();
    const body = modelRequestSchema.parse(json);

    // Step 4: Proxy request to vLLM backend
    const backendUrl = new URL(`${VLLM_BACKEND_URL}/api/model-request`);
    
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
        status: 'pending',
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
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { errors: error.errors },
        { status: 400 }
      );
    }

    console.error('vLLM Model Request Proxy error:', error);
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
 * GET endpoint to retrieve model requests for the current user
 */
export async function GET(req: Request) {
  try {
    // Verify user is authenticated
    const session = await auth();

    if (!session || !session.user || !session.user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
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
    const backendUrl = new URL(`${VLLM_BACKEND_URL}/api/model-request`);
    backendUrl.searchParams.append('userId', userId);
    backendUrl.searchParams.append('userEmail', userEmail || '');

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
      return NextResponse.json(
        { error: `Backend API returned ${response.status}: ${response.statusText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    
    // Ensure we return an array
    const requestsArray = Array.isArray(data) ? data : 
                          (data && typeof data === 'object' && Array.isArray(data.requests)) ? data.requests : [];
    
    return NextResponse.json(requestsArray);

  } catch (error) {
    console.error('vLLM Model Request GET error:', error);
    return NextResponse.json(
      { 
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

