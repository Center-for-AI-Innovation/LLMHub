import { memo } from 'react';
import { Button } from '@/components/ui/button';
import { PublicApiDialog } from '@/components/public-api-dialog';
import { ShareDeploymentDialog } from '@/components/share-deployment-dialog';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import {
  Loader2,
  Calendar,
  Square,
  ArrowRight,
  Share2,
  Terminal,
} from 'lucide-react';
import { setPreferredChatModel } from '@/lib/chat-navigation';
import { modelCardGradient } from '@/lib/models/utils';
import { ModelCardIcon } from './model-card-icon';
import { ModelSpecChips } from './model-metadata-chips';
import type { DeploymentStatusInfo } from '@/lib/models/deployment-status';
import type { 
  ModelInfo,
  ModelDeployment,
} from '@/hooks/use-models';

// Stable class names for buttons
const outlineButtonHoverClass =
  'text-foreground transition-colors hover:bg-white/80 hover:text-foreground hover:shadow-sm dark:hover:bg-white/15 dark:hover:text-accent-foreground dark:hover:shadow-none';
const halfWidthOutlineButtonClass = cn(
  'w-1/2 bg-white/50 dark:bg-white/5 border-0',
  outlineButtonHoverClass,
);
const flexOutlineButtonClass = cn(
  'flex-1 bg-white/50 dark:bg-white/5 border-0',
  outlineButtonHoverClass,
);

function formatLocalDateTime(value: string) {
  const normalizedValue = /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(value)
    ? value
    : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalizedValue);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

// Memoized Active Model Card component
const ActiveModelCard = memo(({ 
  model, 
  getModelDeployment, 
  getStatusInfo,
  handleStopModel,
  openLogsPanel,
  stoppingDeploymentId,
  currentUserId,
}: { 
  model: ModelInfo, 
  getModelDeployment: (model: ModelInfo) => ModelDeployment | undefined, 
  getStatusInfo: (status: string) => DeploymentStatusInfo,
  handleStopModel: (deploymentId: string) => Promise<void>,
  openLogsPanel: (deploymentId: string, modelName: string) => void,
  stoppingDeploymentId: string | null,
  currentUserId?: string,
}) => {
  const gradient = modelCardGradient;
  const deployment = getModelDeployment(model);
  const statusInfo = deployment ? getStatusInfo(deployment.status) : null;
  const isDeploymentApiReady = Boolean(
    deployment &&
      ['ready', 'running'].includes(deployment.status.toLowerCase()),
  );
  const apiDeployments = deployment && isDeploymentApiReady ? [deployment] : [];
  const isStoppingCurrentDeployment = Boolean(
    deployment?.id && stoppingDeploymentId === deployment.id,
  );
  const isDeploymentOwner = Boolean(
    deployment?.id && currentUserId && deployment.userId === currentUserId,
  );
  const displayModelName =
    ((model as unknown as { name?: string }).name ??
      model.modelName ??
      model.id);

  function handleOpenLogs() {
    if (deployment?.id) {
      openLogsPanel(deployment.id, deployment.modelName || displayModelName);
    }
  }
  
  return (
    <div 
      key={model.id} 
      className={cn(
        "relative p-6 rounded-[1.5rem] bg-gradient-to-br",
        gradient,
        "shadow-[0_2px_10px_rgba(0,0,0,0.08)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]",
        "backdrop-blur-sm flex flex-col h-full",
      )}
    >
      <ModelCardIcon model={model} displayModelName={displayModelName} />

      <div className="mb-2 flex items-start justify-between gap-3">
        <h3 className="min-w-0 flex-1 text-xl font-semibold truncate">
          {displayModelName}
        </h3>
        {statusInfo && (
          <div
            className={cn(
              'shrink-0 rounded-full px-2 py-1 text-xs font-medium flex items-center gap-1',
              statusInfo.colorClass,
            )}
          >
            <statusInfo.icon
              className={cn('size-3', statusInfo.iconClassName)}
            />
            {statusInfo.label}
          </div>
        )}
      </div>

      {deployment?.expiresAt && (
        <p className="mb-2 flex items-center gap-1 text-sm font-semibold text-amber-600 dark:text-amber-400">
   
          <Calendar className="size-3 shrink-0" aria-hidden />
          <span>Expires <span suppressHydrationWarning>{formatLocalDateTime(deployment.expiresAt)}</span></span>
        </p>
      )}

      <p className="text-muted-foreground line-clamp-2 mb-4">{model.description}</p>
      
      <div className="mb-6 flex flex-wrap gap-2">
        <ModelSpecChips model={model} />
      </div>

      <div className="mt-auto flex w-full gap-3">
        <PublicApiDialog
          deployments={apiDeployments}
          defaultDeploymentId={isDeploymentApiReady ? deployment?.id : undefined}
          trigger={
            <Button
              type="button"
              variant="outline"
              className={halfWidthOutlineButtonClass}
              disabled={!isDeploymentApiReady}
            >
              API
            </Button>
          }
        />
        <Button asChild className="w-1/2 group transition-colors hover:bg-primary/90 hover:shadow-sm">
          <Link
            href={`/chat?model=${model.id}`}
            onClick={(event) => {
              event.stopPropagation();
              const preferredModelId = deployment?.slurmJobId
                ? `vllm-job:${deployment.slurmJobId}`
                : 'vllm-model';
              setPreferredChatModel(preferredModelId);
            }}
          >
            Chat
            <ArrowRight className="ml-2 size-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </Button>
      </div>

      <div className="mt-3 flex w-full gap-3">
        {isDeploymentOwner && (
          <Button
            variant="outline"
            className={flexOutlineButtonClass}
            onClick={(event) => {
              event.stopPropagation();
              if (deployment?.id) {
                void handleStopModel(deployment.id);
              }
            }}
            disabled={Boolean(stoppingDeploymentId) || !deployment?.id}
          >
            {isStoppingCurrentDeployment ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Square className="mr-2 size-4" />
            )}
            Stop
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className={flexOutlineButtonClass}
          onClick={handleOpenLogs}
          disabled={!deployment?.id}
        >
          <Terminal className="mr-2 size-4" />
          Logs
        </Button>
        {isDeploymentOwner && (
          <ShareDeploymentDialog
            deploymentId={deployment?.id}
            modelName={deployment?.modelName || displayModelName}
            disabled={!deployment?.id}
            trigger={
              <Button
                type="button"
                variant="outline"
                className={flexOutlineButtonClass}
                disabled={!deployment?.id}
              >
                <Share2 className="mr-2 size-4" />
                Share
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
});
ActiveModelCard.displayName = 'ActiveModelCard';

export { ActiveModelCard }; 
