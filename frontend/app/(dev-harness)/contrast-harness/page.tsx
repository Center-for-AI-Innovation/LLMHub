import { notFound } from 'next/navigation';

import { getDeploymentStatusInfo } from '@/lib/models/deployment-status';
import {
  ExpiresChip,
  ModelMetadataChip,
  SCALE_COLORS,
} from '@/components/model-card/model-metadata-chips';
import { Brain } from 'lucide-react';

const DEPLOYMENT_STATUSES = [
  'pending',
  'launching',
  'running',
  'failed',
  'shutdown',
  'completed',
] as const;

const SCALE_BUCKETS = Object.keys(SCALE_COLORS) as Array<
  keyof typeof SCALE_COLORS
>;

/**
 * Dev-only harness that renders every status/chip color variant with no
 * network or auth dependency, so contrast can be checked against the
 * tokens directly. Not linked from the app nav; 404s outside development.
 */
export default function ContrastHarnessPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return (
    <main className="p-8 space-y-8 bg-background text-foreground">
      <section data-testid="deployment-status-badges" className="space-y-2">
        <h2 className="text-lg font-semibold">Deployment statuses</h2>
        <div className="flex flex-wrap gap-3">
          {DEPLOYMENT_STATUSES.map((status) => {
            const info = getDeploymentStatusInfo(status);
            const Icon = info.icon;
            return (
              <span
                key={status}
                data-testid={`status-${status}`}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${info.colorClass}`}
              >
                <Icon className={`size-3 shrink-0 ${info.iconClassName ?? ''}`} />
                {info.label}
              </span>
            );
          })}
        </div>
      </section>

      <section data-testid="model-metadata-chips" className="space-y-2">
        <h2 className="text-lg font-semibold">Model metadata chips</h2>
        <div className="flex flex-wrap gap-3">
          {SCALE_BUCKETS.map((bucket) => (
            <ModelMetadataChip
              key={bucket}
              icon={Brain}
              label={bucket}
              value="42"
              color={SCALE_COLORS[bucket]}
            />
          ))}
          <ExpiresChip value="2026-08-01" />
        </div>
      </section>
    </main>
  );
}
