import * as React from 'react';
import type { ModelInfo } from '@/hooks/use-models';

// Create a Model context to share data without prop drilling
const ModelContext = React.createContext<{
  models: ModelInfo[];
  isLoadingModels: boolean;
  launchModel: (
    modelId: string,
    huggingfaceId?: string,
    family?: string,
  ) => Promise<void>;
  launchingModelId: string | null;
  openLogsPanel?: (deploymentId: string, modelName: string) => void;
}>({
  models: [],
  isLoadingModels: false,
  launchModel: async () => {},
  launchingModelId: null,
  openLogsPanel: undefined,
});

export { ModelContext };
