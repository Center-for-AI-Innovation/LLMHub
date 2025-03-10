'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Bot, Cpu, Sparkles, Zap, Server, RefreshCw, Loader2, ArrowRight, Calendar, CheckCircle2, Search } from 'lucide-react';
import { RequestModelDialog } from '@/components/request-model-dialog';
import { ModelInfo } from '@/lib/models/types';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Navbar } from '@/components/navbar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';

// Interface for model deployments
interface ModelDeployment {
  id: string;
  modelId: string;
  status: 'STARTING' | 'RUNNING' | 'FAILED' | 'STOPPED';
  url?: string;
  createdAt: string;
  expiresAt: string;
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
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [deployments, setDeployments] = useState<ModelDeployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launchingModels, setLaunchingModels] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<string>("available");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searching, setSearching] = useState(false);

  // Fetch models and deployments on component mount
  useEffect(() => {
    fetchModels();
    fetchDeployments();

    // Set up polling for deployments (every 10 seconds)
    const intervalId = setInterval(() => {
      fetchDeployments();
    }, 100000);

    // Clean up interval on unmount
    return () => clearInterval(intervalId);
  }, []);

  // Fetch models when search query changes (with debounce)
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (searchQuery.trim()) {
        fetchModels(searchQuery);
      } else {
        fetchModels();
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery]);

  // Function to fetch models
  const fetchModels = async (query?: string) => {
    try {
      if (query) {
        setSearching(true);
      } else {
        setLoading(true);
      }
      setError(null);
      
      const url = query ? `/api/models?query=${encodeURIComponent(query)}` : '/api/models';
      const response = await fetch(url);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to fetch models: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Check if there's an error message in the response
      if (data.error) {
        setError(data.error);
        setModels(data.models || []);
      } else {
        setModels(data);
      }
    } catch (err: any) {
      console.error('Error fetching models:', err);
      setError(err.message || 'Failed to load models. Please try again later.');
      setModels([]);
    } finally {
      setLoading(false);
      setSearching(false);
    }
  };

  // Function to fetch deployments
  const fetchDeployments = async () => {
    try {
      const response = await fetch('/api/deployments');
      
      if (!response.ok) {
        console.error('Failed to fetch deployments:', response.statusText);
        return;
      }
      
      const data = await response.json();
      // Ensure deployments is always an array
      const deploymentsArray = Array.isArray(data) ? data : [];
      setDeployments(deploymentsArray);

      // If we have active deployments and we're on the available tab, switch to active tab
      if (deploymentsArray.length > 0 && activeTab === "available" && launchingModels && Object.keys(launchingModels).length > 0) {
        setActiveTab("active");
      }
    } catch (err) {
      console.error('Error fetching deployments:', err);
      // Set empty array on error
      setDeployments([]);
    }
  };

  // Function to refresh models and deployments
  const refreshModels = async () => {
    try {
      setRefreshing(true);
      setError(null);
      
      const response = await fetch('/api/models', {
        method: 'POST',
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to refresh models: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Check if there's an error message in the response
      if (!data.success) {
        setError(data.message || 'Failed to refresh models');
        setModels(data.models || []);
      } else {
        setModels(data.models);
      }

      // Also refresh deployments
      await fetchDeployments();
    } catch (err: any) {
      console.error('Error refreshing models:', err);
      setError(err.message || 'Failed to refresh models. Please try again later.');
    } finally {
      setRefreshing(false);
    }
  };

  // Function to launch a model
  const launchModel = async (modelId: string) => {
    try {
      // Set launching state
      setLaunchingModels(prev => ({ ...prev, [modelId]: true }));
      
      const response = await fetch('/api/models/launch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ modelId }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to launch model: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Refresh deployments to show the new one
      await fetchDeployments();
      
      // Switch to active tab
      setActiveTab("active");
      
      return data;
    } catch (err: any) {
      console.error('Error launching model:', err);
      alert(`Failed to launch model: ${err.message}`);
      throw err;
    } finally {
      // Clear launching state after a short delay to allow for UI feedback
      setTimeout(() => {
        setLaunchingModels(prev => {
          const newState = { ...prev };
          delete newState[modelId];
          return newState;
        });
      }, 1000);
    }
  };

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

  // Check if a model is deployed
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
        return { label: 'Failed', color: 'bg-destructive/10 text-destructive', icon: Server };
      case 'STOPPED':
        return { label: 'Stopped', color: 'bg-muted text-muted-foreground', icon: Server };
      default:
        return { label: status, color: 'bg-primary/10 text-primary', icon: Server };
    }
  };

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
              {searching && (
                <Loader2 className="absolute right-2.5 top-2.5 size-4 animate-spin text-muted-foreground" />
              )}
            </div>
            <RequestModelDialog />
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-destructive/10 text-destructive rounded-lg">
            {error}
          </div>
        )}

        {loading ? (
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
                onClick={() => fetchModels()}
                disabled={refreshing || loading}
                className="h-9 bg-white/50 dark:bg-white/5 border-0 shadow-sm group flex items-center gap-1"
              >
                {refreshing ? (
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
                    const statusInfo = deployment ? getStatusInfo(deployment.status) : getStatusInfo('WARM');
                    const StatusIcon = statusInfo.icon;
                    
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
                          <span className={cn("rounded-full px-2 py-1 text-xs font-medium whitespace-nowrap flex items-center gap-1", statusInfo.color)}>
                            {deployment?.status === 'STARTING' ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <StatusIcon className="size-3" />
                            )}
                            {statusInfo.label}
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
                          {deployment && deployment.expiresAt && (
                            <div className="col-span-2 flex items-center gap-1 text-amber-500">
                              <Calendar className="size-3" />
                              <span>Expires: {new Date(deployment.expiresAt).toLocaleString()}</span>
                            </div>
                          )}
                        </div>
                        
                        <div className="mt-auto flex justify-between w-full gap-3">
                          <Button 
                            variant="outline" 
                            className="w-1/2 bg-white/50 dark:bg-white/5 border-0"
                          >
                            API Docs
                          </Button>
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
                    const isLaunching = launchingModels[model.id] || false;
                    
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
                            onClick={() => launchModel(model.id)}
                            disabled={isLaunching}
                          >
                            {isLaunching ? (
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
                    onClick={refreshModels} 
                    disabled={refreshing}
                    className="min-w-[150px] group"
                  >
                    {refreshing ? (
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
              {error || "There are currently no models available. Please check back later or contact support if this issue persists."}
            </p>
            <Button 
              onClick={refreshModels} 
              disabled={refreshing}
              className="min-w-[150px] group"
            >
              {refreshing ? (
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