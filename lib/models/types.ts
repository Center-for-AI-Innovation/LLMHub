export interface ModelConfig {
  model_family: string;
  model_variant: string;
  model_type: string;
  num_gpus: number;
  num_nodes: number;
  vocab_size: number;
  max_model_len: number;
  max_num_seqs: number;
  pipeline_parallelism: boolean;
  enforce_eager: boolean;
  time: string;
  partition: string;
  data_type: string;
  venv: string;
  log_dir: string;
  model_weights_parent_dir: string;
}

export interface BackendModelResponse {
  success: boolean;
  models?: Record<string, ModelConfig>;
  model?: ModelConfig;
  error?: string;
  output?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  status: 'warm' | 'cold' ;
  type: 'Small' | 'Medium' | 'Large';
  family: string;
  variant: string;
  specs: {
    gpus: number;
    nodes: number;
    contextLength: number;
    parallelism: boolean;
  };
}

export type ModelSize = 'Small' | 'Medium' | 'Large';

// Helper function to determine model size based on GPU count
export function getModelSize(gpuCount: number): ModelSize {
  if (gpuCount <= 1) return 'Small';
  if (gpuCount <= 2) return 'Medium';
  return 'Large';
}

// Helper function to generate a description based on model name and specs
export function generateModelDescription(name: string, family: string, contextLength: number): string {
  const descriptions: Record<string, string> = {
    'c4ai-command-r': 'High-performance model optimized for academic research and analysis',
    'llama': 'Open-source model suitable for various NLP tasks',
    'mistral': 'Efficient open-source model with strong reasoning capabilities',
    'mixtral': 'Mixture-of-experts model with advanced reasoning and instruction following',
    'phi': 'Compact and efficient model with strong reasoning capabilities',
    'gemma': 'Google\'s lightweight open model for various text generation tasks',
    'codellama': 'Specialized model for code understanding and generation',
    'claude': 'High-performance model optimized for academic research and analysis',
    'gpt': 'Advanced model for language understanding and generation',
  };

  // Find the matching family prefix
  const matchingFamily = Object.keys(descriptions).find(key => 
    family.toLowerCase().includes(key.toLowerCase()) || name.toLowerCase().includes(key.toLowerCase())
  );

  if (matchingFamily) {
    return descriptions[matchingFamily];
  }

  // Default description based on context length
  if (contextLength > 32000) {
    return `Advanced model with ${contextLength.toLocaleString()} token context window for complex tasks`;
  } else if (contextLength > 8000) {
    return `Versatile model with ${contextLength.toLocaleString()} token context for various applications`;
  } else {
    return `Efficient model optimized for performance and reliability`;
  }
}

// Helper function to format model name for display
export function formatModelName(modelId: string): string {
  // Remove common prefixes and format nicely
  return modelId
    .replace(/-/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
} 