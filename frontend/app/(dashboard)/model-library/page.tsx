'use client';

import { useState, Suspense, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RequestModelDialog } from '@/components/request-model-dialog';
import {
  Loader2,
  RefreshCw,
  Search,
  Server,
} from 'lucide-react';

import {
  useModels,
  useModelDeployments,
  useRefreshModels,
  useLaunchModel,
  useLaunchDefaults,
  type ModelDeployment,
  type ModelInfo,
} from '@/hooks/use-models';

import { useDebounce } from '@/hooks/use-debounce';
import { fullWidthButtonClass } from '@/lib/models/utils';
import {
  ModelGrid,
  ModelContext,
} from '@/components/model-card';
import { toast } from '@/components/ui/use-toast';
import { isActiveDeploymentStatus } from '@/lib/models/deployment-status';

function deploymentMatchesModel(deployment: ModelDeployment, model: ModelInfo) {
  const modelId = model.id.toLowerCase();
  return [deployment.modelId, deployment.modelName].some(
    (value) => value?.toLowerCase() === modelId,
  );
}

function parseLaunchError(error: unknown): string {
  if (typeof error === 'string' && error.trim().length > 0) {
    return error.trim();
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  return 'Failed to launch model. Please try again.';
}

function ModelLibraryPageInner() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launchingModelId, setLaunchingModelId] = useState<string | null>(null);

  const {
    data: models = [],
    isLoading: isLoadingModels,
    error: modelsError,
  } = useModels(debouncedSearchQuery);

  const {
    data: deployments = [],
    isLoading: isLoadingDeployments,
    error: deploymentsError,
  } = useModelDeployments();

  const { mutate: refreshModels, isPending: isRefreshing } = useRefreshModels();
  const { mutateAsync: launchModelAsync } = useLaunchModel();
  const { data: launchDefaults, error: launchDefaultsError } = useLaunchDefaults();

  const error = modelsError || deploymentsError;
  const isSearching = debouncedSearchQuery.trim() !== '';
  const isGridLoading =
    (isLoadingModels && isSearching) ||
    ((isLoadingModels || isLoadingDeployments) &&
      models.length === 0 &&
      !isSearching);

  const availableModels = models.filter(
    (model) =>
      !deployments.some(
        (d) =>
          deploymentMatchesModel(d, model) &&
          isActiveDeploymentStatus(d.status),
      ),
  );

  const availableModelIds = availableModels.map((model) => model.id);

  async function stableLaunchModel(
    modelId: string,
    huggingfaceId?: string,
    family?: string,
    time?: string,
  ) {
    if (!launchDefaults) {
      const message = launchDefaultsError instanceof Error
        ? launchDefaultsError.message
        : 'Launch configuration unavailable. Please refresh and try again.';
      setLaunchError(message);
      toast({ title: 'Cannot launch model', description: message, variant: 'destructive' });
      return;
    }
    setLaunchingModelId(modelId);
    try {
      const deployment = await launchModelAsync({
        modelId,
        huggingfaceId,
        family,
        time: time ?? launchDefaults.time,
        partition: launchDefaults.partition,
        resource_type: launchDefaults.resource_type,
      });
      setLaunchError(null);
      if (deployment?.id) {
        const modelName = deployment.modelName || modelId;
        router.push(
          `/active-models?openLogs=${deployment.id}&modelName=${encodeURIComponent(modelName)}`,
        );
      }
    } catch (err) {
      const message = parseLaunchError(err);
      setLaunchError(message);
      toast({
        title: 'Model launch failed',
        description: message,
        variant: 'destructive',
      });
      console.error('Failed to launch model:', err);
    } finally {
      setLaunchingModelId(null);
    }
  }

  function handleRefresh() {
    setLaunchError(null);
    refreshModels();
  }

  function handleSearchChange(e: ChangeEvent<HTMLInputElement>) {
    setSearchQuery(e.target.value);
  }

  const modelContextValue = {
    models: availableModels,
    isLoadingModels,
    launchModel: stableLaunchModel,
    launchingModelId,
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="container mx-auto p-6">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Model Library</h1>
            <p className="text-muted-foreground">
              Browse available models and request custom deployments
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
            <RequestModelDialog />
          </div>
        </div>

        {error ? (
          <div className="mb-6 p-4 bg-destructive/10 text-destructive rounded-lg">
            {error instanceof Error
              ? error.message
              : 'An error occurred while fetching models'}
          </div>
        ) : null}

        {launchError ? (
          <div className="mb-6 p-4 bg-destructive/10 text-destructive rounded-lg">
            {launchError}
          </div>
        ) : null}

        <div className="flex items-center mb-6 gap-2">
          {/* Toolbar refresh disabled — catalog sync is rarely needed here; empty states still offer retry. */}
          {/* <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing || isGridLoading}
            className={refreshButtonClass}
          >
            {isRefreshing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4 group-hover:animate-spin" />
            )}
            <span>Refresh</span>
          </Button> */}
          <div className="ml-auto relative w-56 sm:w-64">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search models..."
              className="pl-9 bg-white/50 dark:bg-white/5 border-0 shadow-sm"
              value={searchQuery}
              onChange={handleSearchChange}
            />
            {isLoadingModels && isSearching && (
              <Loader2 className="absolute right-2.5 top-2.5 size-4 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>

        {isGridLoading ? (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="size-8 animate-spin text-primary" />
          </div>
        ) : availableModels.length > 0 ? (
          <ModelContext.Provider value={modelContextValue}>
            <ModelGrid modelIds={availableModelIds} />
          </ModelContext.Provider>
        ) : isSearching ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="bg-gradient-to-br from-muted/30 to-muted/10 rounded-full p-8 mb-8 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]">
              <Search className="size-12 text-muted-foreground" />
            </div>
            <h3 className="text-2xl font-medium mb-3">No models found</h3>
            <p className="text-muted-foreground max-w-md">
              No models match &ldquo;{debouncedSearchQuery}&rdquo;. Try a different
              search term.
            </p>
          </div>
        ) : models.length > 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="bg-gradient-to-br from-muted/30 to-muted/10 rounded-full p-8 mb-8 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]">
              <Server className="size-12 text-muted-foreground" />
            </div>
            <h3 className="text-2xl font-medium mb-3">No Available Models</h3>
            <p className="text-muted-foreground max-w-md mb-8">
              There are currently no models available for deployment. Please
              check back later or contact support if this issue persists.
            </p>
            <Button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className={fullWidthButtonClass}
            >
              {isRefreshing ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Refreshing...
                </>
              ) : (
                <>
                  <RefreshCw className="size-4 mr-2 group-hover:animate-spin" />
                  Refresh
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="bg-gradient-to-br from-muted/30 to-muted/10 rounded-full p-8 mb-8 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]">
              <Server className="size-12 text-muted-foreground" />
            </div>
            <h3 className="text-2xl font-medium mb-3">No Models Available</h3>
            <p className="text-muted-foreground max-w-md mb-8">
              There are currently no models available. Please check back later
              or contact support if this issue persists.
            </p>
            <Button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className={fullWidthButtonClass}
            >
              {isRefreshing ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Refreshing...
                </>
              ) : (
                <>
                  <RefreshCw className="size-4 mr-2 group-hover:animate-spin" />
                  Refresh
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ModelLibraryPage() {
  return (
    <Suspense fallback={null}>
      <ModelLibraryPageInner />
    </Suspense>
  );
}
