import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { createModelDeployment, getAvailableModelById, getUser } from '@/lib/db/queries';

// Backend API URL
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8000';
const DEV_ENDPOINT_URL = process.env.DEV_VLLM_ENDPOINT || 'http://localhost:8000/v1';
const DEV_MODEL_ID = process.env.DEV_VLLM_MODEL_ID || 'qwen2.5-1.5b-instruct';

export async function GET() {
  try {
    // Validate the session to ensure user is authenticated
    const session = await auth();
    
    if (!session || !session.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get the user's email from the session
    const useremail = session.user.email;
    const userId = session.user.id;
    
    // Build the backend URL with useremail and userId parameters
    const url = new URL(`${BACKEND_API_URL}/api/models/deployments`);
    url.searchParams.append('useremail', useremail || '');
    url.searchParams.append('userId', userId || '');
    
    // Fetch deployments from the backend with useremail
    const response = await fetch(url.toString());
    
    if (!response.ok) {
      throw new Error(`Backend API returned ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Ensure we always return an array
    const deploymentsArray = Array.isArray(data) ? data : 
                            (data && typeof data === 'object' && Array.isArray(data.deployments)) ? data.deployments : [];
    
    return NextResponse.json(deploymentsArray);
  } catch (error) {
    console.error('Error fetching deployments:', error);
    // Return empty array on error
    return NextResponse.json([]);
  }
} 

export async function POST() {
  try {
    const isDevelopment = process.env.NODE_ENV === 'development';

    // TODO: When we have the backend ready, we will modify this to use the backend API.
    if (!isDevelopment) {
      return NextResponse.json(
        { error: 'Model deployments are only available in development mode.' },
        { status: 501 }
      );
    }

    const devUserEmail = process.env.DEV_USER_EMAIL;

    if (!devUserEmail) {
      return NextResponse.json(
        { error: 'DEV_USER_EMAIL is not configured.' },
        { status: 500 }
      );
    }

    const [devUser] = await getUser(devUserEmail);

    if (!devUser) {
      return NextResponse.json(
        { error: 'Dev user not found.' },
        { status: 404 }
      );
    }

    const [model] = await getAvailableModelById({ id: DEV_MODEL_ID });

    if (!model) {
      return NextResponse.json(
        { error: `Model ${DEV_MODEL_ID} is not available.` },
        { status: 404 }
      );
    }

    const deployment = await createModelDeployment({
      modelId: DEV_MODEL_ID,
      modelName: model.name,
      userId: devUser.id,
      slurmJobId: `test-${randomUUID()}`,
      status: 'ready',
      endpointUrl: DEV_ENDPOINT_URL,
    });

    return NextResponse.json(deployment);
  } catch (error) {
    console.error('Error creating deployment:', error);
    return NextResponse.json(
      { error: 'Failed to create deployment.' },
      { status: 500 }
    );
  }
}