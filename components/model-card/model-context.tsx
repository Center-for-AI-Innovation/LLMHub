import * as React from 'react';
import type { ModelInfo } from '@/hooks/use-models';

// Create a Model context to share data without prop drilling
const ModelContext = React.createContext<{
  models: ModelInfo[];
  isLoadingModels: boolean;
  launchModel: (modelId: string, huggingfaceId?: string, family?: string) => Promise<void>;
  isLaunching: boolean;
  openLogsPanel?: (deploymentId: string, modelName: string) => void;
}>({
  models: [],
  isLoadingModels: false,
  launchModel: async () => { },
  isLaunching: false,
  openLogsPanel: undefined,
});

export { ModelContext }; 