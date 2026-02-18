'use client';

import { useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Navbar } from '@/components/navbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RequestModelDialog } from '@/components/request-model-dialog';
import {
  Loader2,
  RefreshCw,
  CheckCircle2,
  Search,
  Server,
  AlertCircle,
  ArrowRight,
} from 'lucide-react';

import {
  useModels,
  useModelDeployments,
  useChatModels,
  useRefreshModels,
  useLaunchModel,
  useStopModel,
  type ModelInfo,
  type ModelDeployment,
} from '@/hooks/use-models';

import { useDebounce } from '@/hooks/use-debounce';
import {
  fullWidthButtonClass,
  refreshButtonClass,
  modelUtilFunctions,
} from '@/lib/models/utils';
import {
  ActiveModelCard,
  VirtualizedModelGrid,
  ModelContext,
} from '@/components/model-card';
import { DeploymentLogsPanel } from '@/components/deployment-logs-panel';
import { toast } from '@/components/ui/use-toast';

function isActiveDeploymentStatus(status: string) {
  return ['pending', 'launching', 'ready', 'running'].includes(
    status.toLowerCase(),
  );
}

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

function getStatusInfo(status: string) {
  switch (status.toLowerCase()) {
    case 'running':
    case 'ready':
      return {
        label: 'Active',
        color:
          'bg-emerald-500/10 text-emerald-500 dark:bg-emerald-500/20 dark:text-emerald-400',
        icon: CheckCircle2,
      };
    case 'starting':
    case 'launching':
    case 'pending':
      return {
        label: 'Starting',
        color:
          'bg-amber-500/10 text-amber-500 dark:bg-amber-500/20 dark:text-amber-400',
        icon: Loader2,
      };
    case 'failed':
      return {
        label: 'Failed',
        color: 'bg-destructive/10 text-destructive',
        icon: AlertCircle,
      };
    case 'stopped':
    case 'shutdown':
    case 'completed':
      return {
        label: 'Stopped',
        color: 'bg-muted text-muted-foreground',
        icon: Server,
      };
    default:
      return {
        label: status,
        color: 'bg-primary/10 text-primary',
        icon: Server,
      };
  }
}

export default function CatalogPage() {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<'active' | 'available'>(
    'available',
  );
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Use debounce for search
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // State for deployment logs panel
  const [logsPanelOpen, setLogsPanelOpen] = useState(false);
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<
    string | null
  >(null);
  const [selectedModelName, setSelectedModelName] = useState<string>('');
  const [launchError, setLaunchError] = useState<string | null>(null);

  // Fetch models and deployments using React Query
  const {
    data: models = [],
    isLoading: isLoadingModels,
    error: modelsError,
    refetch: refetchModels,
  } = useModels(debouncedSearchQuery);

  const {
    data: deployments = [],
    isLoading: isLoadingDeployments,
    error: deploymentsError,
  } = useModelDeployments();
  const { data: chatModelOptions = [] } = useChatModels();

  const { mutate: refreshModels, isPending: isRefreshing } = useRefreshModels();

  const { mutateAsync: launchModelAsync, isPending: isLaunching } =
    useLaunchModel();

  const { mutate: stopModel, isPending: isStopping } = useStopModel();

  // Get model deployment if exists
  function getModelDeployment(model: ModelInfo) {
    const modelName = (model as unknown as { name?: string }).name;
    const targetIds = [
      model.id,
      model.modelName,
      modelName,
      model.variant,
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase());

    return deployments.find(
      (d) =>
        [d.modelId, d.modelName].some((value) => {
          if (!value) return false;
          return targetIds.includes(value.toLowerCase());
        }) &&
        ['pending', 'launching', 'ready', 'running'].includes(
          d.status.toLowerCase(),
        ),
    );
  }

  async function handleStopModel(deploymentId: string): Promise<void> {
    try {
      await stopModel(deploymentId);
    } catch (error) {
      console.error('Failed to stop model:', error);
    }
  }

  async function stableLaunchModel(
    modelId: string,
    huggingfaceId?: string,
    family?: string,
  ) {
    try {
      const deployment = await launchModelAsync({
        modelId,
        huggingfaceId,
        family,
      });
      setLaunchError(null);
      // If launch succeeds, open the logs panel with the new deployment
      if (deployment?.id) {
        setSelectedDeploymentId(deployment.id);
        setSelectedModelName(deployment.modelName || modelId);
        setLogsPanelOpen(true);
      }
    } catch (error) {
      const message = parseLaunchError(error);
      setLaunchError(message);
      toast({
        title: 'Model launch failed',
        description: message,
        variant: 'destructive',
      });
      console.error('Failed to launch model:', error);
    }
  }

  // Handler to open logs panel
  function handleOpenLogsPanel(deploymentId: string, modelName: string) {
    setSelectedDeploymentId(deploymentId);
    setSelectedModelName(modelName);
    setLogsPanelOpen(true);
  }

  // Combined loading and error states
  const isLoading = isLoadingModels || isLoadingDeployments;
  const error = modelsError || deploymentsError;

  // Filter active models (those with deployments)
  const activeModels = (() => {
    const items = deployments
      .filter((deployment) => isActiveDeploymentStatus(deployment.status))
      .map((deployment) => {
        const matched = models.find((model) =>
          deploymentMatchesModel(deployment, model),
        );
        if (matched) return matched;

	        const fallbackId = deployment.modelId || deployment.modelName;
	        return {
	          id: fallbackId,
	          modelName: deployment.modelName || fallbackId,
	          name: deployment.modelName || fallbackId,
	          description: 'Active deployment',
	          status: 'warm',
	          type: 'Medium',
	          family: fallbackId.split('-')[0] || 'custom',
	          variant: fallbackId,
          specs: {
            gpus: 1,
            nodes: 1,
            contextLength: 4096,
            parallelism: false,
          },
        } as unknown as ModelInfo;
      });

    const deduped = new Map(items.map((model) => [model.id, model]));
    return [...deduped.values()];
  })();

  // Filter available models (those without deployments or with failed/stopped deployments)
  const availableModels = models.filter(
    (model) =>
      !deployments.some(
        (d) =>
          deploymentMatchesModel(d, model) &&
          isActiveDeploymentStatus(d.status),
      ),
  );

  // Extract just the IDs for the virtualized components
  const availableModelIds = availableModels.map((model) => model.id);

  // Create context value for available models
  const modelContextValue = {
    models: availableModels,
    isLoadingModels,
    launchModel: stableLaunchModel,
    isLaunching,
    openLogsPanel: handleOpenLogsPanel,
  };

  function handleTabChange(value: string) {
    if (value === 'active' || value === 'available') {
      setActiveTab(value);
    }
  }

  function handleSearchChange(e: ChangeEvent<HTMLInputElement>) {
    setSearchQuery(e.target.value);
  }

  function handleRefresh() {
    setLaunchError(null);
    refreshModels();
  }

  return (
    <>
      <Navbar />
      <div className="container mx-auto p-6">
        <div className="mb-4">
          <Button
            variant="default"
            size="sm"
            className="relative ml-3 h-9 overflow-visible rounded-l-none bg-[#ff5f05] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#e65404] before:absolute before:right-full before:top-0 before:size-0 before:border-y-[18px] before:border-r-[12px] before:border-y-transparent before:border-r-[#ff5f05] before:transition-colors before:content-[''] hover:before:border-r-[#e65404]"
            onClick={() => router.push('/chat')}
          >
            Back to chat
          </Button>
        </div>
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Model Catalog</h1>
            <p className="text-muted-foreground">
              Access pre-configured models or request custom deployments
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
            <div className="relative w-56 sm:w-64">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search models..."
                className="pl-9 bg-white/50 dark:bg-white/5 border-0 shadow-sm"
                value={searchQuery}
                onChange={handleSearchChange}
              />
              {isLoadingModels && debouncedSearchQuery !== '' && (
                <Loader2 className="absolute right-2.5 top-2.5 size-4 animate-spin text-muted-foreground" />
              )}
            </div>
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

        {isLoading ? (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="size-8 animate-spin text-primary" />
          </div>
        ) : models.length > 0 ? (
          <Tabs
            value={activeTab}
            onValueChange={handleTabChange}
            className="w-full"
          >
            <div className="flex items-center mb-6">
              <TabsList className="mr-2">
                <TabsTrigger
                  value="active"
                  className="relative transition-colors duration-200 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                >
                  {activeTab === 'active' && (
                    <span className="absolute inset-0 rounded-md bg-background shadow-sm" />
                  )}
                  <span className="relative z-10 inline-flex items-center">
                    Active Models
                    {activeModels.length > 0 && (
                      <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium">
                        {activeModels.length}
                      </span>
                    )}
                  </span>
                </TabsTrigger>
                <TabsTrigger
                  value="available"
                  className="relative transition-colors duration-200 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                >
                  {activeTab === 'available' && (
                    <span className="absolute inset-0 rounded-md bg-background shadow-sm" />
                  )}
                  <span className="relative z-10 inline-flex items-center">
                    Available Models
                    {availableModels.length > 0 && (
                      <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium">
                        {availableModels.length}
                      </span>
                    )}
                  </span>
                </TabsTrigger>
              </TabsList>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing || isLoading}
                className={refreshButtonClass}
              >
                {isRefreshing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4 group-hover:animate-spin" />
                )}
                <span>Refresh</span>
              </Button>
            </div>

            <TabsContent value="active" className="mt-0">
              {activeModels.length > 0 ? (
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {activeModels.map((model) => (
                    <ActiveModelCard
                      key={model.id}
                      model={model}
                      getModelIcon={modelUtilFunctions.getModelIcon}
                      getModelGradient={modelUtilFunctions.getModelGradient}
                      getModelDeployment={getModelDeployment}
                      getStatusInfo={getStatusInfo}
                      handleStopModel={handleStopModel}
                      openLogsPanel={handleOpenLogsPanel}
                      isStopping={isStopping}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="bg-gradient-to-br from-muted/30 to-muted/10 rounded-full p-8 mb-8 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]">
                    <Server className="size-12 text-muted-foreground" />
                  </div>
                  <h3 className="text-2xl font-medium mb-3">
                    No Active Models
                  </h3>
                  <p className="text-muted-foreground max-w-md mb-8">
                    You don&apos;t have any active model deployments. Launch a
                    model from the Available Models tab.
                  </p>
                  <Button
                    onClick={() => setActiveTab('available')}
                    className={fullWidthButtonClass}
                  >
                    Browse Available Models
                    <ArrowRight className="ml-2 size-4 transition-transform group-hover:translate-x-1" />
                  </Button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="available" className="mt-0">
              {availableModels.length > 0 ? (
                <ModelContext.Provider value={modelContextValue}>
                  <VirtualizedModelGrid modelIds={availableModelIds} />
                </ModelContext.Provider>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="bg-gradient-to-br from-muted/30 to-muted/10 rounded-full p-8 mb-8 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]">
                    <Server className="size-12 text-muted-foreground" />
                  </div>
                  <h3 className="text-2xl font-medium mb-3">
                    No Available Models
                  </h3>
                  <p className="text-muted-foreground max-w-md mb-8">
                    There are currently no models available for deployment.
                    Please check back later or contact support if this issue
                    persists.
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
            </TabsContent>
          </Tabs>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="bg-gradient-to-br from-muted/30 to-muted/10 rounded-full p-8 mb-8 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]">
              <Server className="size-12 text-muted-foreground" />
            </div>
            <h3 className="text-2xl font-medium mb-3">No Models Available</h3>
            <p className="text-muted-foreground max-w-md mb-8">
              {error instanceof Error
                ? error.message
                : 'There are currently no models available. Please check back later or contact support if this issue persists.'}
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

      {/* Deployment Logs Panel */}
      <DeploymentLogsPanel
        open={logsPanelOpen}
        onOpenChange={setLogsPanelOpen}
        deploymentId={selectedDeploymentId}
        modelName={selectedModelName}
      />
    </>
  );
}
