import { NextRequest, NextResponse } from 'next/server';

// Backend API URL
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { modelId } = body;
    
    if (!modelId) {
      return NextResponse.json(
        { error: 'Model ID is required' },
        { status: 400 }
      );
    }
    
    // Call the backend API to launch the model
    const response = await fetch(`${BACKEND_API_URL}/api/models/launch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ modelId }),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.error || `Failed to launch model: ${response.statusText}` },
        { status: response.status }
      );
    }
    
    const data = await response.json();
    
    // Return the deployment data
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error launching model:', error);
    return NextResponse.json(
      { error: 'Failed to launch model. Backend service may be unavailable.' },
      { status: 503 }
    );
  }
} 