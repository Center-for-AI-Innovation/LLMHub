import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  type LucideIcon,
  Rocket,
  XCircle,
} from 'lucide-react';

export type DeploymentStatusInfo = {
  label: string;
  colorClass: string;
  icon: LucideIcon;
  iconClassName?: string;
};

export function isActiveDeploymentStatus(status: string): boolean {
  return ['pending', 'launching', 'ready', 'running'].includes(
    status.toLowerCase(),
  );
}

export function getDeploymentStatusInfo(status: string): DeploymentStatusInfo {
  switch (status.toLowerCase()) {
    case 'pending':
      return {
        label: 'Pending',
        colorClass: 'bg-secondary/10 text-illinois-altgeld',
        icon: Clock,
      };
    case 'launching':
      return {
        label: 'Launching',
        colorClass: 'bg-status-info/10 text-status-info',
        icon: Rocket,
        iconClassName: 'animate-pulse',
      };
    case 'running':
    case 'ready':
      return {
        label: 'Running',
        colorClass: 'bg-status-success/10 text-status-success',
        icon: CheckCircle2,
      };
    case 'failed':
      return {
        label: 'Failed',
        colorClass: 'bg-destructive/10 text-destructive',
        icon: XCircle,
      };
    case 'shutdown':
      return {
        label: 'Shutdown',
        colorClass: 'bg-muted text-muted-foreground',
        icon: AlertTriangle,
      };
    case 'completed':
      return {
        label: 'Completed',
        colorClass: 'bg-muted text-muted-foreground',
        icon: CheckCircle2,
      };
    default:
      return {
        label: 'Pending',
        colorClass: 'bg-secondary/10 text-illinois-altgeld',
        icon: Clock,
      };
  }
}
