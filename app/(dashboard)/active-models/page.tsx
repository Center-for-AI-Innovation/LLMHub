'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  Server,
  ArrowRight,
} from 'lucide-react';

import {
  useModels,
  useModelDeployments,
  useStopModel,
  type ModelInfo,
  type ModelDeployment,
} from '@/hooks/use-models';
import { useSession } from '@/hooks/use-auth';

import { ActiveModelCard } from '@/components/model-card';
import { DeploymentLogsPanel } from '@/components/deployment-logs-panel';
import {
  getDeploymentStatusInfo,
  isActiveDeploymentStatus,
} from '@/lib/models/deployment-status';

function deploymentMatchesModel(deployment: ModelDeployment, model: ModelInfo) {
  const modelId = model.id.toLowerCase();
  return [deployment.modelId, deployment.modelName].some(
    (value) => value?.toLowerCase() === modelId,
  );
}

function deployedModelsHeading(count: number): string {
  if (count === 1) return '1 Deployed model';
  return `${count} Deployed models`;
}

function ActiveModelsPageInner() {
  const searchParams = useSearchParams();
  const [stoppingDeploymentId, setStoppingDeploymentId] = useState<string | null>(null);
  const [logsPanelOpen, setLogsPanelOpen] = useState(false);
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<string | null>(null);
  const [selectedModelName, setSelectedModelName] = useState<string>('');

  const {
    data: models = [],
    isLoading: isLoadingModels,
  } = useModels();

  const {
    data: deployments = [],
    isLoading: isLoadingDeployments,
    error: deploymentsError,
  } = useModelDeployments();

  const { data: session } = useSession();
  const currentUserId = session?.user?.id;

  const { mutateAsync: stopModelAsync } = useStopModel();

  const isLoading = isLoadingModels || isLoadingDeployments;

  function getModelDeployment(model: ModelInfo): ModelDeployment | undefined {
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
    setStoppingDeploymentId(deploymentId);
    try {
      await stopModelAsync(deploymentId);
    } catch (error) {
      console.error('Failed to stop model:', error);
    } finally {
      setStoppingDeploymentId(null);
    }
  }

  function handleOpenLogsPanel(deploymentId: string, modelName: string) {
    setSelectedDeploymentId(deploymentId);
    setSelectedModelName(modelName);
    setLogsPanelOpen(true);
  }

  useEffect(() => {
    const openLogsId = searchParams.get('openLogs');
    const modelNameParam = searchParams.get('modelName');
    if (openLogsId && modelNameParam) {
      handleOpenLogsPanel(openLogsId, modelNameParam);
    }
  }, [searchParams]);

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

  return (
    <div className="h-full overflow-y-auto">
      <div className="container mx-auto p-6">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Your Active Models</h1>
            <p className="text-muted-foreground">
              Access your currently running model deployments
            </p>
          </div>
        </div>

        {deploymentsError ? (
          <div className="mb-6 p-4 bg-destructive/10 text-destructive rounded-lg">
            {deploymentsError instanceof Error
              ? deploymentsError.message
              : 'An error occurred while fetching deployments'}
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="size-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {activeModels.length > 0 && (
              <h2 className="mb-6 text-lg font-semibold tracking-tight text-foreground">
                {deployedModelsHeading(activeModels.length)}
              </h2>
            )}

            {activeModels.length > 0 ? (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
                {activeModels.map((model) => (
                  <ActiveModelCard
                    key={model.id}
                    model={model}
                    getModelDeployment={getModelDeployment}
                    getStatusInfo={getDeploymentStatusInfo}
                    handleStopModel={handleStopModel}
                    openLogsPanel={handleOpenLogsPanel}
                    stoppingDeploymentId={stoppingDeploymentId}
                    currentUserId={currentUserId}
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
                  You don&apos;t have any active model deployments. Launch a model
                  from the Model Library.
                </p>
                <Button asChild className="group">
                  <Link href="/model-library">
                    Browse Model Library
                    <ArrowRight className="ml-2 size-4 transition-transform group-hover:translate-x-1" />
                  </Link>
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <DeploymentLogsPanel
        open={logsPanelOpen}
        onOpenChange={setLogsPanelOpen}
        deploymentId={selectedDeploymentId}
        modelName={selectedModelName}
      />
    </div>
  );
}

export default function ActiveModelsPage() {
  return (
    <Suspense fallback={null}>
      <ActiveModelsPageInner />
    </Suspense>
  );
}
