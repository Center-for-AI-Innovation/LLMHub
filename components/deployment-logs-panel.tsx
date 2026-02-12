'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
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
    color: 'text-[#FF5F05]',
    bgColor: 'bg-[#FF5F05]/10',
    animate: false,
  },
  launching: {
    label: 'Launching',
    icon: Rocket,
    color: 'text-[#1D58A7]',
    bgColor: 'bg-[#1D58A7]/10',
    animate: true,
  },
  ready: {
    label: 'Running',
    icon: CheckCircle2,
    color: 'text-[#009B77]',
    bgColor: 'bg-[#009B77]/10',
  },
  running: {
    label: 'Running',
    icon: CheckCircle2,
    color: 'text-[#009B77]',
    bgColor: 'bg-[#009B77]/10',
  },
  failed: {
    label: 'Failed',
    icon: XCircle,
    color: 'text-[#C8102E]',
    bgColor: 'bg-[#C8102E]/10',
  },
  shutdown: {
    label: 'Shutdown',
    icon: AlertTriangle,
    color: 'text-[#5E6A71]',
    bgColor: 'bg-[#5E6A71]/10',
  },
  completed: {
    label: 'Completed',
    icon: CheckCircle2,
    color: 'text-[#5E6A71]',
    bgColor: 'bg-[#5E6A71]/10',
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
        'flex gap-3 px-4 py-1 font-mono text-xs hover:bg-[#13294B]/[0.06] group',
        isError && 'bg-[#C8102E]/8',
        isWarning && 'bg-[#FF5F05]/10',
        isSuccess && 'bg-[#009B77]/8',
      )}
    >
      <span className="text-[#5E6A71] dark:text-[#A5A5A5] select-none w-8 text-right shrink-0">
        {index + 1}
      </span>
      <span
        className={cn(
          'whitespace-pre-wrap break-all',
          isError && 'text-[#C8102E]',
          isWarning && 'text-[#FF5F05]',
          isSuccess && 'text-[#009B77]',
          !isError &&
            !isWarning &&
            !isSuccess &&
            'text-[#13294B] dark:text-[#E8E9EB]',
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
  const logs = useMemo(
    () => logsData?.logs?.[activeTab] ?? [],
    [logsData, activeTab],
  );
  const displayModelName =
    modelName || logsData?.deployment?.modelName || 'Model';
  const errorMessage = logsData?.deployment?.errorMessage;
  const displayErrorMessage = useMemo(() => {
    if (!errorMessage) return null;
    if (errorMessage.toLowerCase().includes('slurm job failed')) {
      return 'Failed to launch model';
    }
    return errorMessage;
  }, [errorMessage]);

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
        className="w-full sm:max-w-2xl md:max-w-3xl lg:max-w-4xl xl:max-w-5xl p-0 flex flex-col bg-gradient-to-b from-[#F7F8FA] via-white to-[#F7F8FA] dark:from-[#0F1F3A] dark:via-[#13294B] dark:to-[#0F1F3A] border-[#13294B]/20 sm:inset-y-8 sm:h-auto sm:rounded-l-2xl sm:rounded-r-none sm:overflow-hidden"
      >
        {/* Header */}
        <SheetHeader className="p-4 border-b border-[#13294B]/15 shrink-0 bg-white/70 dark:bg-[#13294B]/65 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#13294B]/10 dark:bg-[#13294B]/50">
              <Terminal className="size-4 text-[#13294B] dark:text-[#FF5F05]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <SheetTitle className="text-[#13294B] dark:text-[#F7F8FA] text-left font-display tracking-tight">
                  {displayModelName}
                </SheetTitle>
                <StatusBadge status={status} />
              </div>
              <SheetDescription className="text-[#5E6A71] dark:text-[#C8CDD0] text-left text-xs">
                Deployment Logs
              </SheetDescription>
            </div>
          </div>

          {/* Error message if any */}
          {displayErrorMessage && (
            <div className="mt-3 p-3 rounded-lg bg-[#C8102E]/10 border border-[#C8102E]/25">
              <div className="flex items-start gap-2">
                <XCircle className="size-4 text-[#C8102E] mt-0.5 shrink-0" />
                <p className="text-xs text-[#C8102E]">{displayErrorMessage}</p>
              </div>
            </div>
          )}
        </SheetHeader>

        {/* Tab bar */}
        <div className="flex items-center gap-4 px-4 py-2.5 border-b border-[#13294B]/15 shrink-0 bg-white/80 dark:bg-[#13294B]/45">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveTab('stderr')}
            className={cn(
              'relative h-9 px-1 text-xs font-semibold rounded-none -mb-2.5 hover:bg-transparent transition-colors duration-200',
              activeTab === 'stderr'
                ? '!text-[#13294B] dark:!text-[#F7F8FA] hover:!text-[#13294B] dark:hover:!text-[#F7F8FA]'
                : 'text-[#5E6A71] dark:text-[#C8CDD0] hover:text-[#13294B] dark:hover:text-[#F7F8FA]',
            )}
          >
            <span className="relative z-10 inline-flex items-center gap-1.5">
              <FileText className="size-3" />
              stderr
              {logs.length > 0 && activeTab === 'stderr' && (
                <span className="ml-1 text-zinc-500 dark:text-[#C8CDD0]">
                  ({logs.length})
                </span>
              )}
            </span>
            {activeTab === 'stderr' && (
              <motion.span
                layoutId="logs-tab-underline"
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                className="pointer-events-none absolute bottom-0 inset-x-0 h-0.5 rounded-full bg-[#13294B] dark:bg-[#FF5F05]"
              />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveTab('stdout')}
            className={cn(
              'relative h-9 px-1 text-xs font-semibold rounded-none -mb-2.5 hover:bg-transparent transition-colors duration-200',
              activeTab === 'stdout'
                ? '!text-[#13294B] dark:!text-[#F7F8FA] hover:!text-[#13294B] dark:hover:!text-[#F7F8FA]'
                : 'text-[#5E6A71] dark:text-[#C8CDD0] hover:text-[#13294B] dark:hover:text-[#F7F8FA]',
            )}
          >
            <span className="relative z-10 inline-flex items-center gap-1.5">
              <Terminal className="size-3" />
              stdout
            </span>
            {activeTab === 'stdout' && (
              <motion.span
                layoutId="logs-tab-underline"
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                className="pointer-events-none absolute bottom-0 inset-x-0 h-0.5 rounded-full bg-[#13294B] dark:bg-[#FF5F05]"
              />
            )}
          </Button>

          <div className="flex-1" />

          <Button
            variant="ghost"
            size="sm"
            onClick={copyLogs}
            disabled={logs.length === 0}
            className="h-8 px-2.5 rounded-full text-[#5E6A71] dark:text-[#C8CDD0] hover:text-[#13294B] dark:hover:text-white"
            title={`Copy ${activeTab} logs`}
          >
            {copied ? (
              <Check className="size-3 text-[#009B77]" />
            ) : (
              <Copy className="size-3" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
            className="h-8 px-2.5 rounded-full text-[#5E6A71] dark:text-[#C8CDD0] hover:text-[#13294B] dark:hover:text-white"
          >
            <RefreshCw className={cn('size-3', isLoading && 'animate-spin')} />
          </Button>
        </div>

        {/* Log content */}
        <div
          ref={logsContainerRef}
          className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,rgba(19,41,75,0.02),rgba(19,41,75,0.04))] dark:bg-[linear-gradient(180deg,rgba(9,22,43,0.75),rgba(15,31,58,0.85))]"
          onScroll={handleScroll}
        >
          <div className="h-full">
          {isLoading && logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Loader2 className="size-6 animate-spin text-[#13294B] dark:text-[#FF5F05]" />
              <p className="text-sm text-[#5E6A71] dark:text-[#C8CDD0]">
                Loading logs...
              </p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 p-4">
              <XCircle className="size-6 text-[#C8102E]" />
              <p className="text-sm text-[#C8102E] text-center">
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
                    <Clock className="size-8 text-[#FF5F05]/60" />
                    <div className="absolute inset-0 animate-ping">
                      <Clock className="size-8 text-[#FF5F05]/25" />
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-sm text-[#FF5F05] font-medium">
                      Job is queued
                    </p>
                    <p className="text-xs text-[#5E6A71] dark:text-[#C8CDD0] mt-1">
                      Waiting for resources to become available...
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <Terminal className="size-6 text-[#5E6A71] dark:text-[#C8CDD0]" />
                  <p className="text-sm text-[#5E6A71] dark:text-[#C8CDD0]">
                    No logs available yet
                  </p>
                  <p className="text-xs text-[#7B848A] dark:text-[#A5A5A5]">
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
              className="h-8 px-3 text-xs bg-[#13294B] hover:bg-[#1D58A7] text-white shadow-lg gap-1.5"
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
