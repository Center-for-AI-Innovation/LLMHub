/** Catalog model_family -> Hugging Face org (shared with backend). */
export const FAMILY_TO_ORG: Record<string, string> = {
  'Aya-Expanse': 'CohereLabs',
  BAAI: 'BAAI',
  'DeepSeek-AI': 'deepseek-ai',
  InternVL2_5: 'OpenGVLab',
  Qwen: 'Qwen',
  Qwen2: 'Qwen',
  'Qwen2.5': 'Qwen',
  Qwen3: 'Qwen',
  QwQ: 'Qwen',
  Llama: 'meta-llama',
  'Llama-2': 'meta-llama',
  'Llama-3': 'meta-llama',
  'Llama-3.1': 'meta-llama',
  'Llama-3.2': 'meta-llama',
  'Llama-3.3': 'meta-llama',
  'Meta-Llama-3': 'meta-llama',
  'Meta-Llama-3.1': 'meta-llama',
  'Llama-3.1-Nemotron': 'nvidia',
  Mistral: 'mistralai',
  Mixtral: 'mistralai',
  Pixtral: 'mistralai',
  CodeLlama: 'codellama',
  Gemma: 'google',
  'Gemma-2': 'google',
  'gemma-2': 'google',
  google: 'google',
  Phi: 'microsoft',
  'Phi-3': 'microsoft',
  'Phi-3-vision': 'microsoft',
  'Phi-3.5-vision': 'microsoft',
  Molmo: 'allenai',
  'c4ai-command-r': 'CohereLabs',
  'deepseek-vl2': 'deepseek-ai',
  e5: 'intfloat',
  'glm-4v': 'THUDM',
  'gpt-oss': 'openai',
  'llava-1.5': 'llava-hf',
  'llava-v1.6': 'llava-hf',
  'sentence-transformers': 'sentence-transformers',
};

export function resolveHfModelId(
  modelId: string,
  family?: string,
  huggingfaceId?: string,
): string {
  if (huggingfaceId?.includes('/')) {
    return huggingfaceId;
  }
  if (modelId.includes('/')) {
    return modelId;
  }
  const org = (family && FAMILY_TO_ORG[family]) || family;
  if (!org) {
    return modelId;
  }
  return `${org}/${modelId}`;
}
