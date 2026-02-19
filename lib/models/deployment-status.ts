import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Rocket,
  XCircle,
  type LucideIcon,
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
        colorClass: 'bg-[#FF5F05]/10 text-[#FF5F05]',
        icon: Clock,
      };
    case 'launching':
      return {
        label: 'Launching',
        colorClass: 'bg-[#1D58A7]/10 text-[#1D58A7]',
        icon: Rocket,
        iconClassName: 'animate-pulse',
      };
    case 'running':
    case 'ready':
      return {
        label: 'Running',
        colorClass: 'bg-[#009B77]/10 text-[#009B77]',
        icon: CheckCircle2,
      };
    case 'failed':
      return {
        label: 'Failed',
        colorClass: 'bg-[#C8102E]/10 text-[#C8102E]',
        icon: XCircle,
      };
    case 'shutdown':
      return {
        label: 'Shutdown',
        colorClass: 'bg-[#5E6A71]/10 text-[#5E6A71]',
        icon: AlertTriangle,
      };
    case 'completed':
      return {
        label: 'Completed',
        colorClass: 'bg-[#5E6A71]/10 text-[#5E6A71]',
        icon: CheckCircle2,
      };
    default:
      return {
        label: 'Pending',
        colorClass: 'bg-[#FF5F05]/10 text-[#FF5F05]',
        icon: Clock,
      };
  }
}
