import { NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';

// Backend API URL
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8000';

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