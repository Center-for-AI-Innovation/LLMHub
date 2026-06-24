import Image from 'next/image';
import { cn } from '@/lib/utils';
import { modelUtilFunctions } from '@/lib/models/utils';
import type { ModelInfo } from '@/hooks/use-models';

function ModelCardIcon({
  model,
  displayModelName,
}: {
  model: ModelInfo;
  displayModelName: string;
}) {
  const Icon = modelUtilFunctions.getModelIcon(model);
  const orgIconPath = modelUtilFunctions.getOrgIconPath(displayModelName);

  return (
    <div
      className={cn(
        'relative size-12 shrink-0 overflow-hidden rounded-full',
        orgIconPath
          ? 'bg-white'
          : 'inline-flex items-center justify-center bg-white/20 dark:bg-white/10',
      )}
    >
      {orgIconPath ? (
        <Image
          src={orgIconPath}
          alt={displayModelName}
          fill
          sizes="48px"
          className={cn(
            'object-contain',
            !orgIconPath.endsWith('.webp') && 'p-1.5',
          )}
        />
      ) : (
        <Icon className="absolute inset-0 m-auto size-6 text-primary" />
      )}
    </div>
  );
}

export { ModelCardIcon };
