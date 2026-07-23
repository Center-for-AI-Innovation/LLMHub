// Share a deployment with one or more users by email
export type ShareDeploymentStatus =
  | 'added'
  | 'already_shared'
  | 'invited'
  | 'already_invited'
  | 'invalid'
  | 'failed';

export interface ShareDeploymentResultEntry {
  email: string;
  status: ShareDeploymentStatus;
  message?: string;
}

export interface ShareDeploymentResponse {
  results: ShareDeploymentResultEntry[];
  summary: {
    added: number;
    alreadyShared: number;
    invited: number;
    alreadyInvited: number;
    invalid: number;
    failed: number;
  };
}

export const SHARE_STATUS_LABEL: Record<ShareDeploymentStatus, string> = {
  added: 'Access granted',
  already_shared: 'Already had access',
  invited: 'Invited (pending signup)',
  already_invited: 'Already invited',
  invalid: 'Invalid email',
  failed: 'Failed',
};

export const SHARE_STATUS_TONE: Record<ShareDeploymentStatus, string> = {
  added: 'text-status-success',
  already_shared: 'text-muted-foreground',
  invited: 'text-status-info',
  already_invited: 'text-muted-foreground',
  invalid: 'text-status-neutral',
  failed: 'text-destructive',
};
