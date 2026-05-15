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
