'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
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
  useRefreshModels, 
  useLaunchModel, 
  useStopModel,
} from '@/hooks/use-models';

import { useDebounce } from '@/hooks/use-debounce';
import { fullWidthButtonClass, refreshButtonClass, modelUtilFunctions } from '@/lib/models/utils';
import { 
  ActiveModelCard, 
  VirtualizedModelGrid, 
  ModelContext 
} from '@/components/model-card';

export default function CatalogPage() {
  const [activeTab, setActiveTab] = useState<string>("available");
  const [searchQuery, setSearchQuery] = useState<string>("");
  
  // Use debounce for search
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  
  // Fetch models and deployments using React Query
  const { 
    data: models = [], 
    isLoading: isLoadingModels, 
    error: modelsError,
    refetch: refetchModels
  } = useModels(debouncedSearchQuery);
  
  const { 
    data: deployments = [], 
    isLoading: isLoadingDeployments,
    error: deploymentsError
  } = useModelDeployments();
  
  const { 
    mutate: refreshModels, 
    isPending: isRefreshing 
  } = useRefreshModels();
  
  const { 
    mutate: launchModel, 
    isPending: isLaunching 
  } = useLaunchModel();
  
  const { 
    mutate: stopModel, 
    isPending: isStopping 
  } = useStopModel();
  
  // Effect to change to active tab if we have deployments
  useEffect(() => {
    if (deployments.length > 0 && activeTab === "available") {
      setActiveTab("active");
    }
  }, [deployments, activeTab]);
  
  // Get model deployment if exists - memoized
  const getModelDeployment = useCallback((modelId: string) => {
    return deployments.find(d => d.modelId === modelId && (d.status === 'running' || d.status === 'launching'));
  }, [deployments]);
  
  // Get deployment status label and color - memoized
  const getStatusInfo = useCallback((status: string) => {
    switch (status) {
      case 'running':
        return { label: 'Active', color: 'bg-emerald-500/10 text-emerald-500 dark:bg-emerald-500/20 dark:text-emerald-400', icon: CheckCircle2 };
      case 'launching':
        return { label: 'Starting', color: 'bg-amber-500/10 text-amber-500 dark:bg-amber-500/20 dark:text-amber-400', icon: Loader2 };
      case 'failed':
        return { label: 'Failed', color: 'bg-destructive/10 text-destructive', icon: AlertCircle };
      case 'shutdown':
        return { label: 'Stopped', color: 'bg-muted text-muted-foreground', icon: Server };
      default:
        return { label: status, color: 'bg-primary/10 text-primary', icon: Server };
    }
  }, []);
  
  // Handle stopping a model - memoized with proper Promise<void> return type
  const handleStopModel = useCallback(async (deploymentId: string): Promise<void> => {
    try {
      await stopModel(deploymentId);
    } catch (error) {
      console.error('Failed to stop model:', error);
    }
  }, [stopModel]);

  // Stabilized launch model function for context
  const stableLaunchModel = useCallback(async (modelId: string) => {
    try {
      await launchModel(modelId);
    } catch (error) {
      console.error('Failed to launch model:', error);
    }
  }, [launchModel]);
  
  // Combined loading and error states
  const isLoading = isLoadingModels || isLoadingDeployments;
  const error = modelsError || deploymentsError;
  
  // Filter active models (those with deployments) - memoized
  const activeModels = useMemo(() => models.filter(model => 
    deployments.some(d => d.modelId === model.id && (d.status === 'running' || d.status === 'launching'))
  ), [models, deployments]);
  
  // Filter available models (those without deployments or with failed/stopped deployments) - memoized
  const availableModels = useMemo(() => models.filter(model => 
    !deployments.some(d => d.modelId === model.id && (d.status === 'running' || d.status === 'launching'))
  ), [models, deployments]);

  // Extract just the IDs for the virtualized components
  const availableModelIds = useMemo(() => 
    availableModels.map(model => model.id),
    [availableModels]
  );

  // Create context value for available models
  const modelContextValue = useMemo(() => ({
    models: availableModels,
    isLoadingModels,
    launchModel: stableLaunchModel,
    isLaunching
  }), [availableModels, isLoadingModels, stableLaunchModel, isLaunching]);

  // Memoize the tab change handler
  const handleTabChange = useCallback((value: string) => {
    setActiveTab(value);
  }, []);

  // Memoize the search handler
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  }, []);

  // Memoize the refresh handler
  const handleRefresh = useCallback(() => {
    refreshModels();
  }, [refreshModels]);

  return (
    <>
      <Navbar />
      <div className="container mx-auto p-6">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Model Catalog</h1>
            <p className="text-muted-foreground">
              Access pre-configured models or request custom deployments
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <div className="relative w-full max-w-xs">
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
            {error instanceof Error ? error.message : 'An error occurred while fetching models'}
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="size-8 animate-spin text-primary" />
          </div>
        ) : models.length > 0 ? (
          <Tabs defaultValue={activeTab} onValueChange={handleTabChange} className="w-full">
            <div className="flex items-center mb-6">
              <TabsList className="mr-2">
                <TabsTrigger value="active" className="relative">
                  Active Models
                  {activeModels.length > 0 && (
                    <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium">
                      {activeModels.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="available">
                  Available Models
                  {availableModels.length > 0 && (
                    <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium">
                      {availableModels.length}
                    </span>
                  )}
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
                      isStopping={isStopping}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="bg-gradient-to-br from-muted/30 to-muted/10 rounded-full p-8 mb-8 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]">
                    <Server className="size-12 text-muted-foreground" />
                  </div>
                  <h3 className="text-2xl font-medium mb-3">No Active Models</h3>
                  <p className="text-muted-foreground max-w-md mb-8">
                    You don&apos;t have any active model deployments. Launch a model from the Available Models tab.
                  </p>
                  <Button 
                    onClick={() => setActiveTab("available")} 
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
                  <h3 className="text-2xl font-medium mb-3">No Available Models</h3>
                  <p className="text-muted-foreground max-w-md mb-8">
                    There are currently no models available for deployment. Please check back later or contact support if this issue persists.
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
              {error instanceof Error ? error.message : "There are currently no models available. Please check back later or contact support if this issue persists."}
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
    </>
  );
} 