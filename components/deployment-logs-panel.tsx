'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Rocket,
  Terminal,
  FileText,
  AlertTriangle,
  ChevronDown,
  RefreshCw,
  Copy,
  Check,
} from 'lucide-react';
import { useDeploymentLogs } from '@/hooks/use-models';

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

// Status configuration for Railway-style status indicators
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
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
    animate: false,
  },
  launching: {
    label: 'Launching',
    icon: Rocket,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    animate: true,
  },
  ready: {
    label: 'Ready',
    icon: CheckCircle2,
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-500/10',
  },
  running: {
    label: 'Running',
    icon: CheckCircle2,
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-500/10',
  },
  failed: {
    label: 'Failed',
    icon: XCircle,
    color: 'text-red-500',
    bgColor: 'bg-red-500/10',
  },
  shutdown: {
    label: 'Shutdown',
    icon: AlertTriangle,
    color: 'text-zinc-500',
    bgColor: 'bg-zinc-500/10',
  },
  completed: {
    label: 'Completed',
    icon: CheckCircle2,
    color: 'text-zinc-500',
    bgColor: 'bg-zinc-500/10',
  },
};

function StatusBadge({ status }: { status: DeploymentStatus }) {
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

function LogLine({ line, index }: { line: string; index: number }) {
  // Detect log level from content
  const isError = /error|fail|exception|traceback/i.test(line);
  const isWarning = /warn|warning/i.test(line);
  const isSuccess = /ready|success|complete|started/i.test(line);

  return (
    <div
      className={cn(
        'flex gap-3 px-4 py-0.5 font-mono text-xs hover:bg-white/5 group',
        isError && 'bg-red-500/5',
        isWarning && 'bg-amber-500/5',
        isSuccess && 'bg-emerald-500/5',
      )}
    >
      <span className="text-zinc-600 dark:text-zinc-500 select-none w-8 text-right shrink-0">
        {index + 1}
      </span>
      <span
        className={cn(
          'whitespace-pre-wrap break-all',
          isError && 'text-red-400',
          isWarning && 'text-amber-400',
          isSuccess && 'text-emerald-400',
          !isError && !isWarning && !isSuccess && 'text-zinc-300',
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
  const [activeTab, setActiveTab] = useState<'stderr' | 'stdout'>('stderr');
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
  const logs = logsData?.logs?.[activeTab] || [];
  const displayModelName =
    modelName || logsData?.deployment?.modelName || 'Model';
  const errorMessage = logsData?.deployment?.errorMessage;

  // Handle scroll to detect if user scrolled up
  const handleScroll = useCallback(() => {
    if (!logsContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;

    if (!isAtBottom && autoScroll) {
      setAutoScroll(false);
    }
  }, [autoScroll]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const scrollToBottom = useCallback(() => {
    setAutoScroll(true);
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const copyLogs = useCallback(async () => {
    const textToCopy = logs.join('\n');
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy logs:', err);
    }
  }, [logs]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl p-0 flex flex-col bg-zinc-950 border-zinc-800"
      >
        {/* Header */}
        <SheetHeader className="p-4 border-b border-zinc-800 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-zinc-800">
                <Terminal className="size-4 text-zinc-400" />
              </div>
              <div>
                <SheetTitle className="text-zinc-100 text-left">
                  {displayModelName}
                </SheetTitle>
                <SheetDescription className="text-zinc-500 text-left text-xs">
                  Deployment Logs
                </SheetDescription>
              </div>
            </div>
            <StatusBadge status={status} />
          </div>

          {/* Error message if any */}
          {errorMessage && (
            <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <div className="flex items-start gap-2">
                <XCircle className="size-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-xs text-red-400">{errorMessage}</p>
              </div>
            </div>
          )}
        </SheetHeader>

        {/* Tab bar */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-zinc-800 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveTab('stderr')}
            className={cn(
              'h-7 px-3 text-xs font-medium gap-1.5',
              activeTab === 'stderr'
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50',
            )}
          >
            <FileText className="size-3" />
            stderr
            {logs.length > 0 && activeTab === 'stderr' && (
              <span className="ml-1 text-zinc-500">({logs.length})</span>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveTab('stdout')}
            className={cn(
              'h-7 px-3 text-xs font-medium gap-1.5',
              activeTab === 'stdout'
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50',
            )}
          >
            <Terminal className="size-3" />
            stdout
          </Button>

          <div className="flex-1" />

          <Button
            variant="ghost"
            size="sm"
            onClick={copyLogs}
            disabled={logs.length === 0}
            className="h-7 px-2 text-zinc-500 hover:text-zinc-300"
            title={`Copy ${activeTab} logs`}
          >
            {copied ? (
              <Check className="size-3 text-emerald-500" />
            ) : (
              <Copy className="size-3" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
            className="h-7 px-2 text-zinc-500 hover:text-zinc-300"
          >
            <RefreshCw className={cn('size-3', isLoading && 'animate-spin')} />
          </Button>
        </div>

        {/* Log content */}
        <div
          ref={logsContainerRef}
          className="flex-1 overflow-y-auto bg-zinc-900/50"
          onScroll={handleScroll}
        >
          {isLoading && logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Loader2 className="size-6 animate-spin text-zinc-500" />
              <p className="text-sm text-zinc-500">Loading logs...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 p-4">
              <XCircle className="size-6 text-red-500" />
              <p className="text-sm text-red-400 text-center">
                {error instanceof Error ? error.message : 'Failed to load logs'}
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
              {status === 'pending' || status === 'launching' ? (
                <>
                  <div className="relative">
                    <Clock className="size-8 text-amber-500/50" />
                    <div className="absolute inset-0 animate-ping">
                      <Clock className="size-8 text-amber-500/30" />
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-sm text-amber-400 font-medium">
                      Job is queued
                    </p>
                    <p className="text-xs text-zinc-500 mt-1">
                      Waiting for resources to become available...
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <Terminal className="size-6 text-zinc-600" />
                  <p className="text-sm text-zinc-500">No logs available yet</p>
                  <p className="text-xs text-zinc-600">
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

        {/* Footer with scroll indicator */}
        {!autoScroll && logs.length > 0 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
            <Button
              size="sm"
              onClick={scrollToBottom}
              className="h-8 px-3 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 shadow-lg gap-1.5"
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
