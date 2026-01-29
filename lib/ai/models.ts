import { createOpenAI, openai } from '@ai-sdk/openai';
import { fireworks } from '@ai-sdk/fireworks';
import {
  customProvider,
  extractReasoningMiddleware,
  wrapLanguageModel,
} from 'ai';

export const DEFAULT_CHAT_MODEL: string = 'vllm-model';

// TODO: We do not need to support OpenAI models.
// We will only support models we deploy through SLURM
// Create custom OpenAI provider for NCSA endpoints
// const customOpenAI = createOpenAI({
//   baseURL: process.env.NCSA_BASE_URL,
//   apiKey: process.env.NCSA_API_KEY,
// });

// Create vLLM provider for local vLLM server (OpenAI-compatible)
const vllmBaseURL = process.env.VLLM_BASE_URL || 'http://localhost:8000/v1';
const vllmApiKey = process.env.VLLM_API_KEY || 'dummy-key'; // vLLM doesn't require API key by default

export const vllmProvider = createOpenAI({
  baseURL: vllmBaseURL,
  apiKey: vllmApiKey,
});

// Default vLLM model
export const VLLM_MODEL = process.env.VLLM_MODEL || 'Qwen/Qwen2.5-1.5B-Instruct';

export const myProvider = customProvider({
  languageModels: {
    // 'chat-model-small': openai('gpt-4o-mini'),
    // 'chat-model-large': customOpenAI('Qwen/Qwen2.5-VL-72B-Instruct'),
    // 'chat-model-reasoning': wrapLanguageModel({
    //   model: fireworks('accounts/fireworks/models/deepseek-r1'),
    //   middleware: extractReasoningMiddleware({ tagName: 'think' }),
    // }),
    // 'title-model': openai('gpt-4-turbo'),
    // 'artifact-model': openai('gpt-4o-mini'),
    // vLLM model - uses local vLLM server
    'vllm-model': vllmProvider(VLLM_MODEL),
  }
});

interface ChatModel {
  id: string;
  name: string;
  description: string;
}

export const chatModels: Array<ChatModel> = [
  {
    id: 'vllm-model',
    name: `${VLLM_MODEL}`,
    description: `Deployed vLLM model (${VLLM_MODEL})`,
  },
];
