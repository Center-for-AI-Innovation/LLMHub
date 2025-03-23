'use client';

import { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Navbar } from '@/components/navbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RequestModelDialog } from '@/components/request-model-dialog';
import { cn } from '@/lib/utils';
import { CalendarIcon } from '@radix-ui/react-icons';
import Link from 'next/link';
import {
  Sparkles,
  Bot,
  Cpu,
  Server,
  Zap,
  Loader2,
  RefreshCw,
  CheckCircle2,
  Search,
  Calendar,
  Play,
  Square,
  AlertCircle,
  ArrowRight,
} from 'lucide-react';

import { 
  useModels, 
  useModelDeployments, 
  useRefreshModels, 
  useLaunchModel, 
  useStopModel,
  type ModelInfo,
  type ModelDeployment
} from '@/hooks/use-models';

// Custom useDebounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

// Map model families to icons and colors
const modelIcons: Record<string, any> = {
  'gpt': Sparkles,
  'claude': Bot,
  'llama': Cpu,
  'codellama': Zap,
  'c4ai-command-r': Server,
  'default': Server,
};

// Color gradients for different model families
const modelGradients: Record<string, string> = {
  'gpt': 'from-emerald-500/10 to-emerald-500/5',
  'claude': 'from-purple-500/10 to-purple-500/5',
  'llama': 'from-blue-500/10 to-blue-500/5',
  'codellama': 'from-amber-500/10 to-amber-500/5',
  'c4ai': 'from-orange-500/10 to-orange-500/5',
  'default': 'from-primary/10 to-primary/5',
};

export default function CatalogPage() {
  const [activeTab, setActiveTab] = useState<string>("available");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [launchingModels, setLaunchingModels] = useState<Record<string, boolean>>({});
  
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
    if (deployments.length > 0 && activeTab === "available" && Object.keys(launchingModels).length > 0) {
      setActiveTab("active");
    }
  }, [deployments, activeTab, launchingModels]);
  
  // Get icon for model
  const getModelIcon = (model: ModelInfo) => {
    // Try to match by family first
    for (const [key, icon] of Object.entries(modelIcons)) {
      if (model.family.toLowerCase().includes(key.toLowerCase()) || 
          model.id.toLowerCase().includes(key.toLowerCase())) {
        return icon;
      }
    }
    // Default icon
    return modelIcons.default;
  };
  
  // Get gradient for model
  const getModelGradient = (model: ModelInfo) => {
    // Try to match by family first
    for (const [key, gradient] of Object.entries(modelGradients)) {
      if (model.family.toLowerCase().includes(key.toLowerCase()) || 
          model.id.toLowerCase().includes(key.toLowerCase())) {
        return gradient;
      }
    }
    // Default gradient
    return modelGradients.default;
  };
  
  // Get model deployment if exists
  const getModelDeployment = (modelId: string) => {
    return deployments.find(d => d.modelId === modelId);
  };
  
  // Filter active models (those with deployments)
  const activeModels = models.filter(model => 
    deployments.some(d => d.modelId === model.id && (d.status === 'RUNNING' || d.status === 'STARTING'))
  );
  
  // Filter available models (those without deployments or with failed/stopped deployments)
  const availableModels = models.filter(model => 
    !deployments.some(d => d.modelId === model.id && (d.status === 'RUNNING' || d.status === 'STARTING'))
  );
  
  // Get deployment status label and color
  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'RUNNING':
        return { label: 'Active', color: 'bg-emerald-500/10 text-emerald-500 dark:bg-emerald-500/20 dark:text-emerald-400', icon: CheckCircle2 };
      case 'STARTING':
        return { label: 'Starting', color: 'bg-amber-500/10 text-amber-500 dark:bg-amber-500/20 dark:text-amber-400', icon: Loader2 };
      case 'FAILED':
        return { label: 'Failed', color: 'bg-destructive/10 text-destructive', icon: AlertCircle };
      case 'STOPPED':
        return { label: 'Stopped', color: 'bg-muted text-muted-foreground', icon: Server };
      default:
        return { label: status, color: 'bg-primary/10 text-primary', icon: Server };
    }
  };
  
  // Handle launching a model
  const handleLaunchModel = async (modelId: string) => {
    // Set launching state
    setLaunchingModels(prev => ({ ...prev, [modelId]: true }));
    
    try {
      // Launch model
      await launchModel(modelId);
    } catch (error) {
      console.error('Failed to launch model:', error);
    } finally {
      // Clear launching state
      setLaunchingModels(prev => ({ ...prev, [modelId]: false }));
    }
  };
  
  // Handle stopping a model
  const handleStopModel = async (deploymentId: string) => {
    try {
      await stopModel(deploymentId);
    } catch (error) {
      console.error('Failed to stop model:', error);
    }
  };
  
  // Check if a specific model is being launched
  const isModelLaunching = (modelId: string) => {
    return launchingModels[modelId] || false;
  };
  
  // Combined loading and error states
  const isLoading = isLoadingModels || isLoadingDeployments;
  const error = modelsError || deploymentsError;

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
                onChange={(e) => setSearchQuery(e.target.value)}
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
          <Tabs defaultValue={activeTab} onValueChange={setActiveTab} className="w-full">
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
                onClick={() => refreshModels()}
                disabled={isRefreshing || isLoading}
                className="h-9 bg-white/50 dark:bg-white/5 border-0 shadow-sm group flex items-center gap-1"
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
                  {activeModels.map((model) => {
                    const Icon = getModelIcon(model);
                    const gradient = getModelGradient(model);
                    const deployment = getModelDeployment(model.id);
                    const statusInfo = deployment ? getStatusInfo(deployment.status) : null;
                    
                    return (
                      <div 
                        key={model.id} 
                        className={cn(
                          "relative p-6 rounded-[1.5rem] bg-gradient-to-br",
                          gradient,
                          "shadow-[0_2px_10px_rgba(0,0,0,0.08)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]",
                          "hover:shadow-[0_4px_20px_rgba(0,0,0,0.12)] dark:hover:shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)]",
                          "backdrop-blur-sm transition-all duration-300 hover:translate-y-[-2px]",
                          "hover:bg-white/[0.05] dark:hover:bg-white/[0.03] group flex flex-col h-full"
                        )}
                      >
                        {statusInfo && (
                          <div className="absolute top-4 right-4">
                            <div className={cn("rounded-full px-2 py-1 text-xs font-medium flex items-center gap-1", statusInfo.color)}>
                              {deployment?.status === 'STARTING' ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <statusInfo.icon className="size-3" />
                              )}
                              {statusInfo.label}
                            </div>
                          </div>
                        )}
                        
                        <div className="mb-4 inline-flex size-12 items-center justify-center rounded-full bg-white/20 dark:bg-white/10">
                          <Icon className="size-6 text-primary" />
                        </div>
                        
                        <div className="mb-2">
                          <h3 className="text-xl font-semibold truncate">{model.name}</h3>
                        </div>
                        
                        <p className="text-muted-foreground line-clamp-2 mb-4">{model.description}</p>
                        
                        <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground mb-6">
                          <div>
                            <span className="font-medium">Type:</span> {model.type}
                          </div>
                          <div>
                            <span className="font-medium">GPUs:</span> {model.specs.gpus}
                          </div>
                          <div className="col-span-2">
                            <span className="font-medium">Context:</span> {model.specs.contextLength.toLocaleString()} tokens
                          </div>
                          {deployment && deployment.expiresAt && (
                            <div className="col-span-2 flex items-center gap-1 text-amber-500">
                              <Calendar className="size-3" />
                              <span>Expires: {new Date(deployment.expiresAt).toLocaleString()}</span>
                            </div>
                          )}
                        </div>
                        
                        <div className="mt-auto flex justify-between w-full gap-3">
                          {deployment && deployment.status === 'RUNNING' && (
                            <Button 
                              variant="outline" 
                              className="w-1/2 bg-white/50 dark:bg-white/5 border-0"
                              onClick={() => deployment && handleStopModel(deployment.id)}
                              disabled={isStopping}
                            >
                              {isStopping ? (
                                <Loader2 className="mr-2 size-4 animate-spin" />
                              ) : (
                                <Square className="mr-2 size-4" />
                              )}
                              Stop
                            </Button>
                          )}
                          {!deployment || deployment.status !== 'RUNNING' ? (
                            <Button 
                              variant="outline" 
                              className="w-1/2 bg-white/50 dark:bg-white/5 border-0"
                            >
                              API Docs
                            </Button>
                          ) : null}
                          <Button 
                            asChild 
                            className="w-1/2 group"
                            disabled={deployment?.status === 'STARTING'}
                          >
                            <Link href={`/chat?model=${model.id}`}>
                              Chat
                              <ArrowRight className="ml-2 size-4 transition-transform group-hover:translate-x-1" />
                            </Link>
                          </Button>
                        </div>
                      </div>
                    );
                  })}
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
                    className="min-w-[150px] group"
                  >
                    Browse Available Models
                    <ArrowRight className="ml-2 size-4 transition-transform group-hover:translate-x-1" />
                  </Button>
                </div>
              )}
            </TabsContent>
            
            <TabsContent value="available" className="mt-0">
              {availableModels.length > 0 ? (
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {availableModels.map((model) => {
                    const Icon = getModelIcon(model);
                    const gradient = getModelGradient(model);
                    const isModelCurrentlyLaunching = isModelLaunching(model.id);
                    
                    return (
                      <div 
                        key={model.id} 
                        className={cn(
                          "relative p-6 rounded-[1.5rem] bg-gradient-to-br",
                          gradient,
                          "shadow-[0_2px_10px_rgba(0,0,0,0.08)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]",
                          "hover:shadow-[0_4px_20px_rgba(0,0,0,0.12)] dark:hover:shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)]",
                          "backdrop-blur-sm transition-all duration-300 hover:translate-y-[-2px]",
                          "hover:bg-white/[0.05] dark:hover:bg-white/[0.03] group flex flex-col h-full"
                        )}
                      >
                        <div className="absolute top-4 right-4">
                          <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary whitespace-nowrap">
                            {model.status}
                          </span>
                        </div>
                        
                        <div className="mb-4 inline-flex size-12 items-center justify-center rounded-full bg-white/20 dark:bg-white/10">
                          <Icon className="size-6 text-primary" />
                        </div>
                        
                        <div className="mb-2">
                          <h3 className="text-xl font-semibold truncate">{model.name}</h3>
                        </div>
                        
                        <p className="text-muted-foreground line-clamp-2 mb-4">{model.description}</p>
                        
                        <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground mb-6">
                          <div>
                            <span className="font-medium">Type:</span> {model.type}
                          </div>
                          <div>
                            <span className="font-medium">GPUs:</span> {model.specs.gpus}
                          </div>
                          <div className="col-span-2">
                            <span className="font-medium">Context:</span> {model.specs.contextLength.toLocaleString()} tokens
                          </div>
                        </div>
                        
                        <div className="mt-auto flex justify-between w-full gap-3">
                          <Button 
                            variant="outline" 
                            className="w-1/2 bg-white/50 dark:bg-white/5 border-0"
                            onClick={() => {}}
                          >
                            Schedule
                            <Calendar className="ml-2 size-4" />
                          </Button>
                          <Button 
                            className="w-1/2 group"
                            onClick={() => handleLaunchModel(model.id)}
                            disabled={isModelCurrentlyLaunching || isLaunching}
                          >
                            {isModelCurrentlyLaunching || isLaunching ? (
                              <>
                                <Loader2 className="mr-2 size-4 animate-spin" />
                                Launching...
                              </>
                            ) : (
                              <>
                                Run Now
                                <ArrowRight className="ml-2 size-4 transition-transform group-hover:translate-x-1" />
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
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
                    onClick={() => refreshModels()} 
                    disabled={isRefreshing}
                    className="min-w-[150px] group"
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
              onClick={() => refreshModels()} 
              disabled={isRefreshing}
              className="min-w-[150px] group"
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