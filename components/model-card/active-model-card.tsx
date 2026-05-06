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
} from 'lucide-react';
import { setPreferredChatModel } from '@/lib/chat-navigation';
import type { DeploymentStatusInfo } from '@/lib/models/deployment-status';
import type { 
  ModelInfo,
  ModelDeployment,
} from '@/hooks/use-models';

// Stable class names for buttons
const scheduleButtonClass = "w-1/2 bg-white/50 dark:bg-white/5 border-0";
const actionButtonClass = "w-1/2 group";

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

function LocalDateTime({ value }: { value: string }) {
  return <span suppressHydrationWarning>{formatLocalDateTime(value)}</span>;
}

// Memoized Active Model Card component
const ActiveModelCard = memo(({ 
  model, 
  getModelIcon, 
  getModelGradient, 
  getModelDeployment, 
  getStatusInfo,
  handleStopModel,
  openLogsPanel,
  stoppingDeploymentId,
}: { 
  model: ModelInfo, 
  getModelIcon: (model: ModelInfo) => any, 
  getModelGradient: (model: ModelInfo) => string,
  getModelDeployment: (model: ModelInfo) => ModelDeployment | undefined, 
  getStatusInfo: (status: string) => DeploymentStatusInfo,
  handleStopModel: (deploymentId: string) => Promise<void>,
  openLogsPanel: (deploymentId: string, modelName: string) => void,
  stoppingDeploymentId: string | null
}) => {
  const Icon = getModelIcon(model);
  const gradient = getModelGradient(model);
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
  const displayModelName =
    ((model as unknown as { name?: string }).name ??
      model.modelName ??
      model.id);
  
  return (
    <div 
      key={model.id} 
      onClick={(event) => {
        // Ignore portal-based clicks (e.g. dialog overlay/content) that bubble
        // through the React tree but are not inside the card DOM node.
        if (!event.currentTarget.contains(event.target as Node)) {
          return;
        }

        if (deployment?.id) {
          openLogsPanel(
            deployment.id,
            deployment.modelName || displayModelName,
          );
        }
      }}
      className={cn(
        "relative p-6 rounded-[1.5rem] bg-gradient-to-br",
        gradient,
        "shadow-[0_2px_10px_rgba(0,0,0,0.08)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]",
        "hover:shadow-[0_4px_20px_rgba(0,0,0,0.12)] dark:hover:shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)]",
        "backdrop-blur-sm hover:bg-white/[0.05] dark:hover:bg-white/[0.03] group flex flex-col h-full cursor-pointer",
        "will-change-transform"
      )}
    >
      {statusInfo && (
        <div className="absolute top-4 right-4">
          <div className={cn("rounded-full px-2 py-1 text-xs font-medium flex items-center gap-1", statusInfo.colorClass)}>
            <statusInfo.icon
              className={cn('size-3', statusInfo.iconClassName)}
            />
            {statusInfo.label}
          </div>
        </div>
      )}
      
      <div className="mb-4 inline-flex size-12 items-center justify-center rounded-full bg-white/20 dark:bg-white/10">
        <Icon className="size-6 text-primary" />
      </div>
      
      <div className="mb-2">
        <h3 className="text-xl font-semibold truncate">{displayModelName}</h3>
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
        {deployment?.expiresAt && (
          <div className="col-span-2 flex items-center gap-1 text-amber-500">
            <Calendar className="size-3" />
            <span>
              Expires: <LocalDateTime value={deployment.expiresAt} />
            </span>
          </div>
        )}
      </div>

      <div className="mt-auto flex justify-between w-full gap-3">
        <Button
          variant="outline"
          className={scheduleButtonClass}
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
        <Button 
          asChild 
          className={actionButtonClass}
        >
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
        <PublicApiDialog
          deployments={apiDeployments}
          defaultDeploymentId={isDeploymentApiReady ? deployment?.id : undefined}
          trigger={
            <Button
              type="button"
              variant="outline"
              className="w-1/2 bg-white/50 dark:bg-white/5 border-0"
              onClick={(event) => event.stopPropagation()}
              disabled={!isDeploymentApiReady}
            >
              API
            </Button>
          }
        />
        <ShareDeploymentDialog
          deploymentId={deployment?.id}
          modelName={deployment?.modelName || displayModelName}
          disabled={!deployment?.id}
          trigger={
            <Button
              type="button"
              variant="outline"
              className="w-1/2 bg-white/50 dark:bg-white/5 border-0"
              onClick={(event) => event.stopPropagation()}
              disabled={!deployment?.id}
            >
              <Share2 className="mr-2 size-4" />
              Share
            </Button>
          }
        />
      </div>

      <p className="mt-3 text-center text-xs text-muted-foreground">
        Click here to view logs
      </p>
    </div>
  );
});
ActiveModelCard.displayName = 'ActiveModelCard';

export { ActiveModelCard }; 
