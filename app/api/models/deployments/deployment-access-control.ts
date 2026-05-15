import {
  getAuthorizedUserByDeploymentIdAndUserId,
  getModelDeploymentById,
} from '@/lib/db/queries';

export type DeploymentAccess = {
  exists: boolean;
  canRead: boolean;
  isOwner: boolean;
};

export async function getDeploymentAccessForUser({
  deploymentId,
  userId,
}: {
  deploymentId: string;
  userId: string;
}): Promise<DeploymentAccess> {
  const deployment = await getModelDeploymentById(deploymentId);
  if (!deployment) {
    return { exists: false, canRead: false, isOwner: false };
  }

  if (deployment.userId === userId) {
    return { exists: true, canRead: true, isOwner: true };
  }

  const accessRow = await getAuthorizedUserByDeploymentIdAndUserId({
    deploymentId,
    userId,
  });
  return {
    exists: true,
    canRead: Boolean(accessRow),
    isOwner: false,
  };
}
