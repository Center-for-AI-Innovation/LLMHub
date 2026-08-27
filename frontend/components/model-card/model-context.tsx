import * as React from 'react';
import type { ModelInfo } from '@/hooks/use-models';
import type { LaunchConfig } from '@/lib/models/launch-config';

// Create a Model context to share data without prop drilling
const ModelContext = React.createContext<{
  models: ModelInfo[];
  isLoadingModels: boolean;
  launchModel: (
    modelId: string,
    huggingfaceId?: string,
    family?: string,
    config?: LaunchConfig,
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
