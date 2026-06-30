import { memo } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Loader2, ArrowRight } from 'lucide-react';
import { ModelContext } from './model-context';
import { LaunchModelDialog } from './launch-model-dialog';
import * as React from 'react';
import { modelCardGradient } from '@/lib/models/utils';
import { ModelCardIcon } from './model-card-icon';
import { ModelSpecChips } from './model-metadata-chips';

const actionButtonClass = 'w-full group';

const ModelCard = memo(({ modelId }: { modelId: string }) => {
  const { models, launchModel, launchingModelId } =
    React.useContext(ModelContext);
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);

  const model = models.find((m) => m.id === modelId);

  const isModelLaunching = launchingModelId === modelId;

  const handleLaunch = async (time: string) => {
    if (!model) return;

    try {
      await launchModel(model.id, model.huggingfaceId, model.family, time);
      setIsDialogOpen(false);
    } catch (error) {
      console.error('Failed to launch model:', error);
    }
  };

  if (!model) {
    return (
      <div className="relative p-6 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 shadow-[0_2px_10px_rgba(0,0,0,0.08)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)] h-[340px] flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const gradient = modelCardGradient;
  const displayModelName =
    ((model as unknown as { name?: string }).name ??
      model.modelName ??
      model.id);

  return (
    <div
      className={cn(
        'relative p-6 rounded-2xl bg-gradient-to-br',
        gradient,
        'shadow-[0_2px_10px_rgba(0,0,0,0.08)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]',
        'hover:shadow-[0_4px_20px_rgba(0,0,0,0.12)] dark:hover:shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)]',
        'hover:bg-white/[0.05] dark:hover:bg-white/[0.03] group flex flex-col h-full',
      )}
    >
      <div className="flex items-center gap-4 mb-4">
        <ModelCardIcon model={model} displayModelName={displayModelName} />
        <h3 className="text-xl font-semibold leading-snug min-w-0">
          {displayModelName}
        </h3>
      </div>

      <p className="text-muted-foreground line-clamp-2 mb-4">
        {model.description}
      </p>

      <div className="mb-6 flex flex-wrap gap-2">
        <ModelSpecChips model={model} />
      </div>

      <div className="mt-auto flex w-full gap-3">
        <Button
          className={actionButtonClass}
          onClick={() => setIsDialogOpen(true)}
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

      <LaunchModelDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        modelName={displayModelName}
        isLaunching={isModelLaunching}
        onLaunch={handleLaunch}
      />
    </div>
  );
});
ModelCard.displayName = 'ModelCard';

export { ModelCard };
