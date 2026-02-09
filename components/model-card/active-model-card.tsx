import { memo } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import {
  Loader2,
  Calendar,
  Square,
  ArrowRight,
} from 'lucide-react';
import type { 
  ModelInfo,
  ModelDeployment,
} from '@/hooks/use-models';

// Stable class names for buttons
const scheduleButtonClass = "w-1/2 bg-white/50 dark:bg-white/5 border-0";
const actionButtonClass = "w-1/2 group";

// Memoized Active Model Card component
const ActiveModelCard = memo(({ 
  model, 
  getModelIcon, 
  getModelGradient, 
  getModelDeployment, 
  getStatusInfo,
  handleStopModel,
  isStopping
}: { 
  model: ModelInfo, 
  getModelIcon: (model: ModelInfo) => any, 
  getModelGradient: (model: ModelInfo) => string,
  getModelDeployment: (modelId: string) => ModelDeployment | undefined, 
  getStatusInfo: (status: string) => { label: string, color: string, icon: any },
  handleStopModel: (deploymentId: string) => Promise<void>,
  isStopping: boolean
}) => {
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
        "backdrop-blur-sm hover:bg-white/[0.05] dark:hover:bg-white/[0.03] group flex flex-col h-full",
        "will-change-transform"
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
        {deployment?.expiresAt && (
          <div className="col-span-2 flex items-center gap-1 text-amber-500">
            <Calendar className="size-3" />
            <span>Expires: {new Date(deployment.expiresAt).toLocaleString()}</span>
          </div>
        )}
      </div>
      
      <div className="mt-auto flex justify-between w-full gap-3">
        {deployment && deployment.status === 'running' && (
          <Button 
            variant="outline" 
            className={scheduleButtonClass}
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
        {!deployment || deployment.status !== 'running' ? (
          <Button 
            variant="outline" 
            className={scheduleButtonClass}
          >
            API Docs
          </Button>
        ) : null}
        <Button 
          asChild 
          className={actionButtonClass}
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
});
ActiveModelCard.displayName = 'ActiveModelCard';

export { ActiveModelCard }; 