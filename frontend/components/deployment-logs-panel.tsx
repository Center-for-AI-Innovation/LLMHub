'use client';

import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  FileText,
  Loader2,
  RefreshCw,
  Rocket,
  Terminal,
  XCircle,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useDeploymentLogs } from '@/hooks/use-models';
import { cn } from '@/lib/utils';

export type DeploymentStatus =
  | 'pending'
  | 'launching'
  | 'ready'
  | 'running'
  | 'failed'
  | 'shutdown'
  | 'completed';

interface DeploymentLogsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deploymentId: string | null;
  modelName?: string;
}

const EMPTY_LOGS: string[] = [];

const statusConfig: Record<
  DeploymentStatus,
  {
    label: string;
    icon: typeof Loader2;
    color: string;
    bgColor: string;
    animate?: boolean;
  }
> = {
  pending: {
    label: 'Pending',
    icon: Clock,
    color: 'text-secondary-accessible',
    bgColor: 'bg-secondary/10',
    animate: false,
  },
  launching: {
    label: 'Launching',
    icon: Rocket,
    color: 'text-status-info',
    bgColor: 'bg-status-info/10',
    animate: true,
  },
  ready: {
    label: 'Running',
    icon: CheckCircle2,
    color: 'text-status-success',
    bgColor: 'bg-status-success/10',
  },
  running: {
    label: 'Running',
    icon: CheckCircle2,
    color: 'text-status-success',
    bgColor: 'bg-status-success/10',
  },
  failed: {
    label: 'Failed',
    icon: XCircle,
    color: 'text-destructive-accessible',
    bgColor: 'bg-destructive/10',
  },
  shutdown: {
    label: 'Shutdown',
    icon: AlertTriangle,
    color: 'text-muted-foreground',
    bgColor: 'bg-muted',
  },
  completed: {
    label: 'Completed',
    icon: CheckCircle2,
    color: 'text-muted-foreground',
    bgColor: 'bg-muted',
  },
};

export function StatusBadge({ status }: { status: DeploymentStatus }) {
  const config = statusConfig[status] || statusConfig.pending;
  const Icon = config.icon;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
        config.bgColor,
        config.color,
      )}
    >
      <Icon className={cn('size-3', config.animate && 'animate-pulse')} />
      {config.label}
    </div>
  );
}

export function LogLine({ line, index }: { line: string; index: number }) {
  const isError = /error|fail|exception|traceback/i.test(line);
  const isWarning = /warn|warning/i.test(line);
  const isSuccess = /ready|success|complete|started/i.test(line);

  return (
    <div
      className={cn(
        'flex gap-3 px-4 py-1 font-mono text-xs hover:bg-primary/[0.06] dark:hover:bg-muted/80 group',
        isError && 'bg-destructive/10',
        isWarning && 'bg-secondary/10',
        isSuccess && 'bg-status-success/10',
      )}
    >
      <span className="text-muted-foreground select-none w-8 text-right shrink-0">
        {index + 1}
      </span>
      <span
        className={cn(
          'whitespace-pre-wrap break-all',
          isError && 'text-destructive-accessible',
          isWarning && 'text-secondary-accessible',
          isSuccess && 'text-status-success',
          !isError && !isWarning && !isSuccess && 'text-foreground',
        )}
      >
        {line || ' '}
      </span>
    </div>
  );
}

export function DeploymentLogsPanel({
  open,
  onOpenChange,
  deploymentId,
  modelName,
}: DeploymentLogsPanelProps) {
  const [activeTab, setActiveTab] = useState<'stdout' | 'stderr'>('stdout');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  const {
    data: logsData,
    isLoading,
    error,
    refetch,
  } = useDeploymentLogs(deploymentId, open);

  const status = (logsData?.deployment?.status ||
    'pending') as DeploymentStatus;
  const statusKey = status.toLowerCase();
  const stdoutLogs = logsData?.logs?.stdout ?? EMPTY_LOGS;
  const stderrLogs = logsData?.logs?.stderr ?? EMPTY_LOGS;
  const logs = logsData?.logs?.[activeTab] ?? EMPTY_LOGS;
  const displayModelName =
    modelName || logsData?.deployment?.modelName || 'Model';
  const errorMessage = logsData?.deployment?.errorMessage;
  const displayErrorMessage = !errorMessage
    ? null
    : errorMessage.toLowerCase().includes('slurm job failed')
      ? 'Failed to launch model'
      : errorMessage;

  function handleScroll() {
    if (!logsContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;

    if (!isAtBottom && autoScroll) {
      setAutoScroll(false);
    }
  }

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  useEffect(() => {
    if (open) {
      setActiveTab('stdout');
    }
  }, [open, deploymentId]);

  function scrollToBottom() {
    setAutoScroll(true);
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  async function copyLogs() {
    const textToCopy = logs.join('\n');
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy logs:', err);
    }
  }

  // This panel intentionally keeps illinois-* utilities for dark-mode accents
  // (gradient stop, header icon tile, tab/heading text) instead of the
  // semantic layer. There's no semantic equivalent for these specific solid
  // dark-mode fills/text without adding new tokens, and illinois-* is
  // explicitly allowed for solid (non-opacity) fills per docs/04-design-system.md.
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl md:max-w-3xl lg:max-w-4xl xl:max-w-5xl p-0 flex flex-col gap-0 bg-gradient-to-b from-muted/50 via-background to-muted/50 dark:from-background dark:via-illinois-blue dark:to-background border-border sm:inset-y-8 sm:h-auto sm:rounded-l-2xl sm:rounded-r-none sm:overflow-hidden [&>button]:size-10 [&>button]:rounded-md [&>button>svg]:size-5"
      >
        {/* Header */}
        <SheetHeader className="p-4 border-b border-border shrink-0 bg-background dark:bg-muted backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 dark:bg-illinois-industrial">
              <Terminal className="size-4 text-primary dark:text-secondary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <SheetTitle className="text-primary dark:text-illinois-white text-left font-display tracking-tight">
                  {displayModelName}
                </SheetTitle>
                <StatusBadge status={status} />
              </div>
              <SheetDescription className="text-muted-foreground dark:text-illinois-storm-80 text-left text-xs">
                Deployment Logs
              </SheetDescription>
            </div>
          </div>

          {displayErrorMessage && (
            <div className="mt-3 p-3 rounded-lg bg-destructive/10 border border-destructive/25">
              <div className="flex items-start gap-2">
                <XCircle className="size-4 text-destructive mt-0.5 shrink-0" />
                <p className="text-xs text-destructive-accessible">
                  {displayErrorMessage}
                </p>
              </div>
            </div>
          )}
        </SheetHeader>

        {/* Tab bar */}
        <div className="flex items-center gap-4 px-4 py-1.5 border-b border-border shrink-0 bg-background/80 dark:bg-muted">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveTab('stdout')}
            className={cn(
              'relative h-10 px-2 text-sm font-semibold rounded-none -mb-2.5 hover:bg-transparent transition-colors duration-200',
              activeTab === 'stdout'
                ? '!text-primary dark:!text-illinois-white hover:!text-primary dark:hover:!text-illinois-white'
                : 'text-muted-foreground hover:text-primary dark:text-illinois-storm-80 dark:hover:text-illinois-white',
            )}
          >
            <span className="relative z-10 inline-flex items-center gap-1.5">
              <Terminal className="size-4" />
              stdout
              {stdoutLogs.length > 0 && (
                <span className="ml-1 text-muted-foreground">
                  ({stdoutLogs.length})
                </span>
              )}
            </span>
            {activeTab === 'stdout' && (
              <motion.span
                layoutId="logs-tab-underline"
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                className="pointer-events-none absolute bottom-0 inset-x-0 h-0.5 rounded-full bg-primary dark:bg-secondary"
              />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveTab('stderr')}
            className={cn(
              'relative h-10 px-2 text-sm font-semibold rounded-none -mb-2.5 hover:bg-transparent transition-colors duration-200',
              activeTab === 'stderr'
                ? '!text-primary dark:!text-illinois-white hover:!text-primary dark:hover:!text-illinois-white'
                : 'text-muted-foreground hover:text-primary dark:text-illinois-storm-80 dark:hover:text-illinois-white',
            )}
          >
            <span className="relative z-10 inline-flex items-center gap-1.5">
              <FileText className="size-4" />
              stderr
              {stderrLogs.length > 0 && (
                <span className="ml-1 text-muted-foreground">
                  ({stderrLogs.length})
                </span>
              )}
            </span>
            {activeTab === 'stderr' && (
              <motion.span
                layoutId="logs-tab-underline"
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                className="pointer-events-none absolute bottom-0 inset-x-0 h-0.5 rounded-full bg-primary dark:bg-secondary"
              />
            )}
          </Button>

          <div className="flex-1" />

          <Button
            variant="ghost"
            size="sm"
            onClick={copyLogs}
            disabled={logs.length === 0}
            className="h-9 px-3 rounded-full text-muted-foreground hover:text-primary dark:text-illinois-storm-80 dark:hover:text-illinois-white"
            title={`Copy ${activeTab} logs`}
          >
            {copied ? (
              <Check className="size-4 text-status-success" />
            ) : (
              <Copy className="size-4" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
            className="h-9 px-3 rounded-full text-muted-foreground hover:text-primary dark:text-illinois-storm-80 dark:hover:text-illinois-white"
          >
            <RefreshCw className={cn('size-4', isLoading && 'animate-spin')} />
          </Button>
        </div>

        {/* Log content */}
        <div
          ref={logsContainerRef}
          className="flex-1 overflow-y-auto bg-muted/60 dark:bg-gradient-to-b dark:from-background dark:via-muted/60 dark:to-background"
          onScroll={handleScroll}
        >
          <div className="h-full">
            {isLoading && logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <Loader2 className="size-6 animate-spin text-primary dark:text-secondary" />
                <p className="text-sm text-muted-foreground">Loading logs...</p>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 p-4">
                <XCircle className="size-6 text-destructive" />
                <p className="text-sm text-destructive-accessible text-center">
                  {error instanceof Error
                    ? error.message
                    : 'Failed to load logs'}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetch()}
                  className="mt-2"
                >
                  Retry
                </Button>
              </div>
            ) : logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                {statusKey === 'pending' || statusKey === 'launching' ? (
                  <>
                    <div className="relative">
                      <Clock className="size-8 text-secondary/60" />
                      <div className="absolute inset-0 animate-ping">
                        <Clock className="size-8 text-secondary/25" />
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-sm text-secondary font-medium">
                        Job is queued
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Waiting for resources to become available...
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <Terminal className="size-6 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      No logs available yet
                    </p>
                    <p className="text-xs text-muted-foreground/70">
                      Logs will appear here once the deployment starts
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className="py-2">
                {logs.map((line, index) => (
                  <LogLine key={`${index}:${line}`} line={line} index={index} />
                ))}
                <div ref={logsEndRef} />
              </div>
            )}
          </div>
        </div>

        {/* Footer with scroll indicator */}
        {!autoScroll && logs.length > 0 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
            <Button
              size="sm"
              onClick={scrollToBottom}
              className="h-8 px-3 text-xs bg-primary hover:bg-status-info text-primary-foreground shadow-lg gap-1.5"
            >
              <ChevronDown className="size-3" />
              Scroll to bottom
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
