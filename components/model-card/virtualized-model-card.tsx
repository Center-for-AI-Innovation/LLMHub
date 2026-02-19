import { memo } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Loader2, Calendar, ArrowRight } from 'lucide-react';
import { ModelContext } from './model-context';
import * as React from 'react';
import { modelUtilFunctions } from '@/lib/models/utils';

// Stable class names for buttons
const scheduleButtonClass = 'w-1/2 bg-white/50 dark:bg-white/5 border-0';
const actionButtonClass = 'w-1/2 group';

// Create an optimized card component that doesn't need props passed in
const VirtualizedModelCard = memo(({ modelId }: { modelId: string }) => {
  const { models, isLoadingModels, launchModel, launchingModelId } =
    React.useContext(ModelContext);

  // Find model data in context
  const model = models.find((m) => m.id === modelId);

  const isModelLaunching = launchingModelId === modelId;

  const handleLaunch = async () => {
    if (!model) return;

    try {
      // Pass modelId, huggingfaceId, and family for proper HF model path construction
      await launchModel(model.id, model.huggingfaceId, model.family);
    } catch (error) {
      console.error('Failed to launch model:', error);
    }
  };

  if (!model || isLoadingModels) {
    return (
      <div className="relative p-6 rounded-3xl bg-gradient-to-br from-primary/10 to-primary/5 shadow-sm h-[340px] flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  // Get icon and gradient
  const Icon = modelUtilFunctions.getModelIcon(model);
  const gradient = modelUtilFunctions.getModelGradient(model);
  const displayModelName =
    ((model as unknown as { name?: string }).name ??
      model.modelName ??
      model.id);

  return (
    <div
      className={cn(
        'relative p-6 rounded-[1.5rem] bg-gradient-to-br',
        gradient,
        'shadow-[0_2px_10px_rgba(0,0,0,0.08)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]',
        'hover:shadow-[0_4px_20px_rgba(0,0,0,0.12)] dark:hover:shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)]',
        'backdrop-blur-sm hover:bg-white/[0.05] dark:hover:bg-white/[0.03] group flex flex-col h-full',
        'will-change-transform',
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
        <h3 className="text-xl font-semibold truncate">{displayModelName}</h3>
      </div>

      <p className="text-muted-foreground line-clamp-2 mb-4">
        {model.description}
      </p>

      <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground mb-6">
        <div>
          <span className="font-medium">Type:</span> {model.type}
        </div>
        <div>
          <span className="font-medium">GPUs:</span> {model.specs.gpus}
        </div>
        <div className="col-span-2">
          <span className="font-medium">Context:</span>{' '}
          {model.specs.contextLength.toLocaleString()} tokens
        </div>
      </div>

      <div className="mt-auto flex justify-between w-full gap-3">
        <Button variant="outline" className={scheduleButtonClass}>
          Schedule
          <Calendar className="ml-2 size-4" />
        </Button>
        <Button
          className={actionButtonClass}
          onClick={handleLaunch}
          disabled={Boolean(launchingModelId)}
        >
          {isModelLaunching ? (
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
});
VirtualizedModelCard.displayName = 'VirtualizedModelCard';

export { VirtualizedModelCard };
