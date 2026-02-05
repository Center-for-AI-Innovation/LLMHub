import { NextResponse } from 'next/server';
import {
  type BackendModelResponse,
  type ModelInfo,
  getModelSize,
  generateModelDescription,
  formatModelName,
} from '@/lib/models/types';
import { getAvailableModels, searchAvailableModels } from '@/lib/db/queries';

// Cache for model catalog
let modelCatalogCache: ModelInfo[] | null = null;
let lastCacheTime = 0;
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes

// Backend API URL
const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8000';

/**
 * Transform backend model data to our frontend format
 */
function transformModels(backendResponse: BackendModelResponse): ModelInfo[] {
  // Check if we have a successful response with models
  if (!backendResponse.success) {
    return [];
  }

  // If we have models as a record (expected format)
  if (
    backendResponse.models &&
    typeof backendResponse.models === 'object' &&
    !Array.isArray(backendResponse.models)
  ) {
    return Object.entries(backendResponse.models).map(([id, config]) => {
      const modelSize = getModelSize(config.num_gpus);

      return {
        id,
        name: formatModelName(id),
        description: generateModelDescription(
          id,
          config.model_family,
          config.max_model_len,
        ),
        status: 'WARM', // Default status, would be updated from actual deployment status
        type: modelSize,
        family: config.model_family,
        variant: config.model_variant,
        specs: {
          gpus: config.num_gpus,
          nodes: config.num_nodes,
          contextLength: config.max_model_len,
          parallelism: config.pipeline_parallelism,
        },
      };
    });
  }

  // If we have output as a string that contains model names (fallback)
  if (backendResponse.output && typeof backendResponse.output === 'string') {
    try {
      // Try to parse the output as JSON if it's a string
      const modelNames = JSON.parse(backendResponse.output);
      if (Array.isArray(modelNames)) {
        return modelNames.map((modelName) => {
          // Extract family and variant from model name
          const nameParts = modelName.split('-');
          const family = nameParts[0].toLowerCase();

          // Determine model size based on name patterns
          let type: 'Small' | 'Medium' | 'Large' = 'Medium';
          if (
            modelName.includes('70B') ||
            modelName.includes('Large') ||
            modelName.includes('405B')
          ) {
            type = 'Large';
          } else if (
            modelName.includes('7B') ||
            modelName.includes('small') ||
            modelName.includes('1.5B') ||
            modelName.includes('3B')
          ) {
            type = 'Small';
          }

          return {
            id: modelName,
            name: formatModelName(modelName),
            description: generateModelDescription(modelName, family, 4096), // Default context length
            status: 'WARM',
            type,
            family,
            variant: nameParts.slice(1).join('-'),
            specs: {
              gpus: type === 'Large' ? 4 : type === 'Medium' ? 2 : 1,
              nodes: type === 'Large' ? 1 : 1,
              contextLength: modelName.includes('128k') ? 131072 : 4096, // Estimate context length
              parallelism: type === 'Large',
            },
          };
        });
      }
    } catch (e) {
      // If parsing fails, try to extract model names from the string
      const modelNames = backendResponse.output
        .replace(/[\[\]']/g, '')
        .split(', ')
        .filter((name) => name.trim().length > 0);

      if (modelNames.length > 0) {
        return modelNames.map((modelName) => {
          // Extract family and variant from model name
          const nameParts = modelName.split('-');
          const family = nameParts[0].toLowerCase();

          // Determine model size based on name patterns
          let type: 'Small' | 'Medium' | 'Large' = 'Medium';
          if (
            modelName.includes('70B') ||
            modelName.includes('Large') ||
            modelName.includes('405B')
          ) {
            type = 'Large';
          } else if (
            modelName.includes('7B') ||
            modelName.includes('small') ||
            modelName.includes('1.5B') ||
            modelName.includes('3B')
          ) {
            type = 'Small';
          }

          return {
            id: modelName,
            name: formatModelName(modelName),
            description: generateModelDescription(modelName, family, 4096), // Default context length
            status: 'WARM',
            type,
            family,
            variant: nameParts.slice(1).join('-'),
            specs: {
              gpus: type === 'Large' ? 4 : type === 'Medium' ? 2 : 1,
              nodes: type === 'Large' ? 1 : 1,
              contextLength: modelName.includes('128k') ? 131072 : 4096, // Estimate context length
              parallelism: type === 'Large',
            },
          };
        });
      }
    }
  }

  return [];
}

/**
 * GET handler for fetching all models
 */
export async function GET(request: Request) {
  try {
    // Get search query from URL
    const url = new URL(request.url);
    const searchQuery = url.searchParams.get('query');

    // If we have a search query, bypass cache and search directly
    if (searchQuery && searchQuery.trim().length > 0) {
      try {
        // Search models in database
        const dbModels = await searchAvailableModels({ query: searchQuery });

        if (dbModels && dbModels.length > 0) {
          // Map database models to frontend format
          const models = dbModels.map((model) => ({
            id: model.id,
            name: model.name,
            description: model.description || '',
            status: model.status as 'WARM' | 'COLD' | 'OFFLINE',
            type: model.type as 'Small' | 'Medium' | 'Large',
            family: model.family,
            variant: model.variant,
            specs: model.specs as any,
            huggingfaceId: model.huggingfaceId || undefined,
          }));

          return NextResponse.json(models);
        }

        // If no models found in database, return empty array
        return NextResponse.json([]);
      } catch (error) {
        console.error('Error searching models:', error);
        return NextResponse.json([], { status: 500 });
      }
    }

    // Check if cache is valid
    const now = Date.now();
    if (modelCatalogCache && now - lastCacheTime < CACHE_TTL) {
      return NextResponse.json(modelCatalogCache);
    }

    try {
      // Fetch from database
      const dbModels = await getAvailableModels();

      if (dbModels && dbModels.length > 0) {
        // Map database models to frontend format
        const models = dbModels.map((model) => ({
          id: model.id,
          name: model.name,
          description: model.description || '',
          status: model.status as 'WARM' | 'COLD' | 'OFFLINE',
          type: model.type as 'Small' | 'Medium' | 'Large',
          family: model.family,
          variant: model.variant,
          specs: model.specs as any,
          huggingfaceId: model.huggingfaceId || undefined,
        }));

        // Update cache
        modelCatalogCache = models;
        lastCacheTime = now;

        return NextResponse.json(models);
      }

      // If no models in database, try to fetch from backend as fallback
      const response = await fetch(`${BACKEND_API_URL}/api/models/`);

      if (!response.ok) {
        throw new Error(
          `Backend API returned ${response.status}: ${response.statusText}`,
        );
      }

      const backendData: BackendModelResponse = await response.json();
      const models = transformModels(backendData);

      // Update cache
      modelCatalogCache = models;
      lastCacheTime = now;

      return NextResponse.json(models);
    } catch (error) {
      console.error('Error fetching models:', error);

      // Return an empty array with a message
      return NextResponse.json(
        {
          models: [],
          error: 'Failed to fetch models. Please try again later.',
        },
        { status: 503 }, // Service Unavailable
      );
    }
  } catch (error) {
    console.error('Error in GET handler:', error);
    return NextResponse.json(
      { error: 'Failed to fetch model catalog' },
      { status: 500 },
    );
  }
}

/**
 * POST handler for refreshing the model cache
 */
export async function POST() {
  try {
    // Invalidate cache
    modelCatalogCache = null;
    lastCacheTime = 0;

    try {
      // Trigger model sync in backend
      const response = await fetch(`${BACKEND_API_URL}/api/models/sync`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(
          `Backend API returned ${response.status}: ${response.statusText}`,
        );
      }

      const result = await response.json();

      if (result.success) {
        // Fetch fresh data from database
        const dbModels = await getAvailableModels();

        // Map database models to frontend format
        const models = dbModels.map((model) => ({
          id: model.id,
          name: model.name,
          description: model.description || '',
          status: model.status as 'WARM' | 'COLD' | 'OFFLINE',
          type: model.type as 'Small' | 'Medium' | 'Large',
          family: model.family,
          variant: model.variant,
          specs: model.specs as any,
          huggingfaceId: model.huggingfaceId || undefined,
        }));

        // Update cache
        modelCatalogCache = models;
        lastCacheTime = Date.now();

        return NextResponse.json({
          success: true,
          message: 'Model catalog refreshed successfully',
          models,
        });
      } else {
        throw new Error(result.error || 'Failed to sync models');
      }
    } catch (error) {
      console.error('Error refreshing model catalog:', error);

      // Return an error message
      return NextResponse.json(
        {
          success: false,
          message: 'Failed to refresh model catalog. Please try again later.',
          models: [],
        },
        { status: 503 },
      ); // Service Unavailable
    }
  } catch (error) {
    console.error('Error in POST handler:', error);
    return NextResponse.json(
      { error: 'Failed to refresh model catalog' },
      { status: 500 },
    );
  }
}
