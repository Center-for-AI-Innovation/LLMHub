import { cn } from '@/lib/utils';
import { Brain, Cpu, Hash, Calendar, type LucideIcon } from 'lucide-react';
import type { ModelInfo } from '@/hooks/use-models';

export type ScaleColor = {
  chipClass: string;
  iconClass: string;
};

export const SCALE_COLORS = {
  positive: {
    chipClass:
      'bg-green-500/15 text-green-800 dark:bg-green-500/20 dark:text-green-300',
    iconClass: 'text-green-600 dark:text-green-400',
  },
  neutral: {
    chipClass:
      'bg-amber-500/15 text-amber-900 dark:bg-amber-500/20 dark:text-amber-300',
    iconClass: 'text-amber-600 dark:text-amber-400',
  },
  heavy: {
    chipClass:
      'bg-orange-500/15 text-orange-900 dark:bg-orange-500/20 dark:text-orange-300',
    iconClass: 'text-orange-600 dark:text-orange-400',
  },
} as const satisfies Record<string, ScaleColor>;

export function getTypeColor(type: ModelInfo['type']): ScaleColor {
  switch (type) {
    case 'Small':
      return SCALE_COLORS.positive;
    case 'Medium':
      return SCALE_COLORS.neutral;
    case 'Large':
      return SCALE_COLORS.heavy;
    default:
      return SCALE_COLORS.neutral;
  }
}

export function getGpuColor(gpus: number): ScaleColor {
  if (gpus <= 2) return SCALE_COLORS.positive;
  if (gpus <= 4) return SCALE_COLORS.neutral;
  return SCALE_COLORS.heavy;
}

export function getContextColor(contextLength: number): ScaleColor {
  if (contextLength <= 16_000) return SCALE_COLORS.positive;
  if (contextLength <= 64_000) return SCALE_COLORS.neutral;
  return SCALE_COLORS.heavy;
}

export function formatContextTokens(contextLength: number): string {
  if (contextLength >= 1_000_000) {
    return `${parseFloat((contextLength / 1_000_000).toFixed(1))}M tokens`;
  }
  if (contextLength >= 1_000) {
    return `${parseFloat((contextLength / 1_000).toFixed(1))}K tokens`;
  }
  return contextLength.toLocaleString() + ' tokens';
}

export function ModelMetadataChip({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  color: ScaleColor;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        color.chipClass,
      )}
    >
      <Icon className={cn('size-3 shrink-0', color.iconClass)} aria-hidden />
      <span className="opacity-100">{label}</span>
      <span className="font-bold">{value}</span>
    </span>
  );
}

/** Renders the standard Type / GPUs / Context chips for any model. */
export function ModelSpecChips({ model }: { model: ModelInfo }) {
  return (
    <>
      <ModelMetadataChip
        icon={Brain}
        label="Type"
        value={model.type}
        color={getTypeColor(model.type)}
      />
      <ModelMetadataChip
        icon={Cpu}
        label="GPUs"
        value={String(model.specs.gpus)}
        color={getGpuColor(model.specs.gpus)}
      />
      <ModelMetadataChip
        icon={Hash}
        label="Context"
        value={formatContextTokens(model.specs.contextLength)}
        color={getContextColor(model.specs.contextLength)}
      />
    </>
  );
}

/** Chip showing a deployment expiry date. */
export function ExpiresChip({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-amber-500/15 text-amber-900 dark:bg-amber-500/20 dark:text-amber-300">
      <Calendar className="size-3 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      <span className="opacity-100">Expires</span>
      {/* suppressHydrationWarning because locale-formatted dates differ between server and client */}
      <span className="font-bold" suppressHydrationWarning>{value}</span>
    </span>
  );
}
