import * as React from 'react';
import type { ModelInfo } from '@/hooks/use-models';

// Create a Model context to share data without prop drilling
const ModelContext = React.createContext<{
  models: ModelInfo[];
  isLoadingModels: boolean;
  launchModel: (modelId: string) => Promise<void>;
  isLaunching: boolean;
}>({
  models: [],
  isLoadingModels: false,
  launchModel: async () => {},
  isLaunching: false
});

export { ModelContext }; 