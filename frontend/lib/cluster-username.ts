const CLUSTER_USERNAME_RE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;

/**
 * Derive the cluster login from an authenticated email address.
 *
 * NCSA/CILogon identities use the email local-part as the cluster username.
 * Impersonation test addresses such as
 * `rohan13+svcllmhubrohan13@ncsa.illinois.edu` keep only the suffix after `+`.
 */
export function clusterUsernameFromEmail(
  email: string | null | undefined,
): string | null {
  if (!email) {
    return null;
  }

  const localPart = email.split('@')[0]?.trim() ?? '';
  const plusIndex = localPart.lastIndexOf('+');
  const clusterUsername =
    plusIndex === -1 ? localPart : localPart.slice(plusIndex + 1).trim();

  if (!CLUSTER_USERNAME_RE.test(clusterUsername)) {
    return null;
  }

  return clusterUsername;
}
