import { type NextRequest, NextResponse } from 'next/server';
import { type BackendModelResponse, type ModelInfo, type ModelSize, getModelSize, generateModelDescription, formatModelName } from '@/lib/models/types';

// Backend API URL
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8000';

/**
 * Transform backend model data to our frontend format
 */
function transformModel(modelId: string, backendResponse: BackendModelResponse): ModelInfo | null {
  // Check if we have a successful response
  if (!backendResponse.success) {
    return null;
  }

  // If we have model as an object (expected format)
  if (backendResponse.model) {
    const config = backendResponse.model;
    const modelSize = getModelSize(config.num_gpus);
    
    return {
      id: modelId,
      name: formatModelName(modelId),
      description: generateModelDescription(modelId, config.model_family, config.max_model_len),
      status: 'warm', // Default status, would be updated from actual deployment status
      size: modelSize,
      family: config.model_family,
      variant: config.model_variant,
      specs: {
        gpus: config.num_gpus,
        nodes: config.num_nodes,
        contextLength: config.max_model_len,
        parallelism: config.pipeline_parallelism,
      }
    };
  }
  
  // If we have output as a string (fallback)
  if (backendResponse.output && typeof backendResponse.output === 'string') {
    // Extract family and variant from model name
    const nameParts = modelId.split('-');
    const family = nameParts[0].toLowerCase();
    
    // Determine model size based on name patterns
    let size: ModelSize = 'Medium';
    if (modelId.includes('70B') || modelId.includes('Large') || modelId.includes('405B')) {
      size = 'Large';
    } else if (modelId.includes('7B') || modelId.includes('small') || modelId.includes('1.5B') || modelId.includes('3B')) {
      size = 'Small';
    }
    
    return {
      id: modelId,
      name: formatModelName(modelId),
      description: generateModelDescription(modelId, family, 4096), // Default context length
      status: 'warm',
      size,
      family,
      variant: nameParts.slice(1).join('-'),
      specs: {
        gpus: size === 'Large' ? 4 : size === 'Medium' ? 2 : 1,
        nodes: size === 'Large' ? 1 : 1,
        contextLength: modelId.includes('128k') ? 131072 : 4096, // Estimate context length
        parallelism: size === 'Large',
      }
    };
  }
  
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> }
) {
  try {
    const { modelId } = await params;
    
    try {
      // Fetch from backend
      const response = await fetch(`${BACKEND_API_URL}/api/models/${modelId}`);
      
      if (response.status === 404) {
        return NextResponse.json(
          { error: `Model with ID ${modelId} not found` },
          { status: 404 }
        );
      }
      
      if (!response.ok) {
        throw new Error(`Backend API returned ${response.status}: ${response.statusText}`);
      }
      
      const backendData: BackendModelResponse = await response.json();
      
      // If the backend response indicates success but doesn't have model details,
      // create a model info based on the model ID
      if (backendData.success && !backendData.model && !backendData.output) {
        // Extract family and variant from model name
        const nameParts = modelId.split('-');
        const family = nameParts[0].toLowerCase();
        
        // Determine model size based on name patterns
        let size: ModelSize = 'Medium';
        if (modelId.includes('70B') || modelId.includes('Large') || modelId.includes('405B')) {
          size = 'Large';
        } else if (modelId.includes('7B') || modelId.includes('small') || modelId.includes('1.5B') || modelId.includes('3B')) {
          size = 'Small';
        }
        
        const modelInfo: ModelInfo = {
          id: modelId,
          name: formatModelName(modelId),
          description: generateModelDescription(modelId, family, 4096), // Default context length
          status: 'warm',
          size,
          family,
          variant: nameParts.slice(1).join('-'),
          specs: {
            gpus: size === 'Large' ? 4 : size === 'Medium' ? 2 : 1,
            nodes: size === 'Large' ? 1 : 1,
            contextLength: modelId.includes('128k') ? 131072 : 4096, // Estimate context length
            parallelism: size === 'Large',
          }
        };
        
        return NextResponse.json(modelInfo);
      }
      
      const model = transformModel(modelId, backendData);
      
      if (!model) {
        return NextResponse.json(
          { error: `Model with ID ${modelId} not found` },
          { status: 404 }
        );
      }
      
      return NextResponse.json(model);
    } catch (error) {
      console.error(`Error fetching from backend API:`, error);
      
      // Return an error message
      return NextResponse.json(
        { error: 'Backend service is currently unavailable. Please try again later.' },
        { status: 503 } // Service Unavailable
      );
    }
  } catch (error) {
    console.error(`Error in GET handler for model detail route:`, error);
    return NextResponse.json(
      { error: 'Failed to fetch model details' },
      { status: 500 }
    );
  }
}
