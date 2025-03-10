import { NextResponse } from 'next/server';

// Backend API URL
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8000';

export async function GET() {
  try {
    // Fetch deployments from the backend
    const response = await fetch(`${BACKEND_API_URL}/api/models/deployments`);
    
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