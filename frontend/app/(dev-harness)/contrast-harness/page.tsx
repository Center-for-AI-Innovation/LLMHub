import { notFound } from 'next/navigation';

import { Brain, Check, ExternalLink } from 'lucide-react';
import { CodeBlock } from '@/components/code-block';
import {
  LogLine,
  StatusBadge,
  type DeploymentStatus,
} from '@/components/deployment-logs-panel';
import {
  ExpiresChip,
  ModelMetadataChip,
  SCALE_COLORS,
} from '@/components/model-card/model-metadata-chips';
import { Button } from '@/components/ui/button';
import {
  SHARE_STATUS_LABEL as STATUS_LABEL,
  SHARE_STATUS_TONE as STATUS_TONE,
} from '@/lib/models/deployment-sharing';
import { getDeploymentStatusInfo } from '@/lib/models/deployment-status';
import { modelCardGradient } from '@/lib/models/utils';

const DEPLOYMENT_STATUSES = [
  'pending',
  'launching',
  'running',
  'failed',
  'shutdown',
  'completed',
] as const;

const LOGS_PANEL_STATUSES: DeploymentStatus[] = [
  'pending',
  'launching',
  'ready',
  'running',
  'failed',
  'shutdown',
  'completed',
];

const SAMPLE_LOG_LINES = [
  'Server started successfully',
  'WARNING: disk space is low',
  'ERROR: failed to connect to backend',
  'Loaded model weights',
];

const SCALE_BUCKETS = Object.keys(SCALE_COLORS) as Array<
  keyof typeof SCALE_COLORS
>;

const BUTTON_VARIANTS = [
  'default',
  'secondary',
  'destructive',
  'outline',
  'ghost',
  'link',
] as const;

const SHARE_STATUSES = Object.keys(STATUS_LABEL) as Array<
  keyof typeof STATUS_LABEL
>;

const CONSOLE_LINE_STATUSES = ['in_progress', 'completed', 'failed'] as const;

/**
 * Dev-only harness that renders every status/chip color variant with no
 * network or auth dependency, so contrast can be checked against the
 * tokens directly. Not linked from the app nav; 404s outside development.
 *
 * Each section mirrors the REAL background it sits on in the actual
 * component (not just the page background) — a text color can pass
 * contrast against a plain background but fail once composited against
 * the tinted/gradient background it's actually rendered on.
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

      <section data-testid="deployment-logs-panel-badges" className="space-y-2">
        <h2 className="text-lg font-semibold">
          Deployment logs panel — status badges
        </h2>
        <div className="flex flex-wrap gap-3">
          {LOGS_PANEL_STATUSES.map((status) => (
            <StatusBadge key={status} status={status} />
          ))}
        </div>
      </section>

      <section data-testid="deployment-logs-panel-lines" className="space-y-2">
        <h2 className="text-lg font-semibold">
          Deployment logs panel — log lines
        </h2>
        <div className="bg-muted/60">
          {SAMPLE_LOG_LINES.map((line, index) => (
            <LogLine key={line} line={line} index={index} />
          ))}
        </div>
      </section>

      <section data-testid="buttons" className="space-y-2">
        <h2 className="text-lg font-semibold">Buttons</h2>
        <div className="flex flex-wrap items-center gap-3">
          {BUTTON_VARIANTS.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
        </div>
      </section>

      <section
        data-testid="share-deployment-status-tones"
        className="space-y-2"
      >
        <h2 className="text-lg font-semibold">
          Share deployment — status tones
        </h2>
        {/* Real usage renders this list inside DialogContent, which uses bg-background */}
        <div className="bg-background p-4 rounded-lg border border-border space-y-1">
          {SHARE_STATUSES.map((status) => (
            <p key={status} className={`text-sm ${STATUS_TONE[status]}`}>
              {STATUS_LABEL[status]}
            </p>
          ))}
        </div>
      </section>

      <section data-testid="destructive-banners" className="space-y-2">
        <h2 className="text-lg font-semibold">Destructive banners</h2>
        {/* Mirrors public-api-dialog.tsx's just-generated-key warning */}
        <div className="bg-background p-4 rounded-lg border border-border">
          <p className="text-xs text-destructive-accessible">
            Your API key will disappear after closing this dialog.
          </p>
        </div>
      </section>

      <section data-testid="sign-out-button" className="space-y-2">
        <h2 className="text-lg font-semibold">Sign out menu item</h2>
        {/* Real usage renders inside a DropdownMenuContent, which uses bg-popover */}
        <div className="bg-popover text-popover-foreground p-2 rounded-lg border border-border w-48">
          <button
            type="button"
            className="w-full text-left px-1 py-0.5 text-destructive"
          >
            Sign out
          </button>
        </div>
      </section>

      <section data-testid="diff-view-marks" className="space-y-2">
        <h2 className="text-lg font-semibold">Diff view marks</h2>
        <p className="text-sm font-mono">
          <span className="bg-status-success/15 text-status-success">
            inserted text
          </span>{' '}
          <span className="bg-destructive/15 line-through text-destructive-accessible">
            deleted text
          </span>
        </p>
      </section>

      <section data-testid="code-blocks" className="space-y-2">
        <h2 className="text-lg font-semibold">Code blocks</h2>
        <p className="text-sm">
          Inline code: <CodeBlock inline>const x = 1;</CodeBlock>
        </p>
        <CodeBlock>{'function hello() {\n  return "world";\n}'}</CodeBlock>
      </section>

      <section data-testid="markdown-link" className="space-y-2">
        <h2 className="text-lg font-semibold">Markdown link</h2>
        <p className="text-sm">
          <a
            className="text-status-info hover:underline"
            href="https://example.com/docs"
            target="_blank"
            rel="noreferrer"
          >
            Read the documentation <ExternalLink className="inline size-3" />
          </a>
        </p>
      </section>

      <section data-testid="active-model-card-expiry" className="space-y-2">
        <h2 className="text-lg font-semibold">
          Active model card — expiry text
        </h2>
        {/* Mirrors the card's own gradient background, not the page background */}
        <div
          className={`relative p-6 rounded-2xl bg-gradient-to-br ${modelCardGradient}`}
        >
          <p className="mb-2 flex items-center gap-1 text-sm font-semibold text-status-neutral">
            <span>Expires 2026-08-01</span>
          </p>
        </div>
      </section>

      <section data-testid="sidebar-muted-label" className="space-y-2">
        <h2 className="text-lg font-semibold">Sidebar muted label</h2>
        {/* Mirrors sidebar-history.tsx's date-group labels on bg-sidebar */}
        <div className="bg-sidebar p-4 rounded-lg">
          <div className="px-2 py-1 text-xs text-muted-foreground">Today</div>
        </div>
      </section>

      <section data-testid="console-status-lines" className="space-y-2">
        <h2 className="text-lg font-semibold">Console status lines</h2>
        <div className="bg-background border border-border rounded-lg">
          {CONSOLE_LINE_STATUSES.map((status) => (
            <div
              key={status}
              className="px-4 py-2 flex flex-row gap-2 text-sm border-b last:border-b-0 border-border font-mono"
            >
              <div
                className={
                  status === 'completed'
                    ? 'text-status-success'
                    : status === 'failed'
                      ? 'text-destructive-accessible'
                      : 'text-muted-foreground'
                }
              >
                [{status}]
              </div>
              <div className="text-foreground">Package installation step</div>
            </div>
          ))}
        </div>
      </section>

      <section data-testid="copy-success-icon" className="space-y-2">
        <h2 className="text-lg font-semibold">Copy success icon</h2>
        <div className="bg-background p-4 rounded-lg border border-border">
          <Check className="size-4 text-status-success" />
        </div>
      </section>
    </main>
  );
}
