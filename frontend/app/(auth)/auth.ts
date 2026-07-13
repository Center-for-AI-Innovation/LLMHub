import 'server-only';

import { betterAuth, APIError } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { nextCookies, toNextJsHandler } from 'better-auth/next-js';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  DEFAULT_CILOGON_DISCOVERY_URL,
  DEFAULT_CILOGON_SKIN,
  getBaseURL,
  isCilogonEnabled,
} from '@/lib/auth/config';
import { db } from '@/lib/db';
import { account, session, user, verification } from '@/lib/db/schema';
import { claimPendingDeploymentInvitesForUser } from '@/lib/db/queries';
import { notifyDeploymentAccessGranted } from '@/lib/models/notify-deployment-access';
import type { AuthSession, AuthUser } from '@/lib/auth/types';

function normalizeUserName(email: string) {
  return email.split('@')[0] || 'Local User';
}

export const authConfig = {
  isCilogonEnabled: isCilogonEnabled(),
};

const authPlugins = authConfig.isCilogonEnabled
  ? [
      genericOAuth({
        config: [
          {
            providerId: 'cilogon',
            clientId: process.env.CILOGON_CLIENT_ID || '',
            clientSecret: process.env.CILOGON_CLIENT_SECRET || '',
            discoveryUrl:
              process.env.CILOGON_DISCOVERY_URL || DEFAULT_CILOGON_DISCOVERY_URL,
              redirectURI: `${getBaseURL()}/api/auth/oauth2/callback/cilogon`,
            scopes: ['openid', 'email', 'profile'],
            authorizationUrlParams: {
              skin: process.env.CILOGON_SKIN || DEFAULT_CILOGON_SKIN,
            },
            mapProfileToUser(profile) {
              const email = String(profile.email ?? '');

              return {
                email,
                name: String(
                  (profile.name ?? profile.given_name ?? email) || 'CILogon User',
                ),
                image: profile.picture ? String(profile.picture) : null,
                emailVerified: Boolean(profile.email_verified ?? true),
              };
            },
          },
        ],
      }),
      nextCookies(),
    ]
  : [nextCookies()];

export const betterAuthInstance = betterAuth({
  appName: 'LLM Hub',
  baseURL: getBaseURL(),
  basePath: '/api/auth',
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: 'pg',
    camelCase: true,
    schema: {
      user,
      session,
      account,
      verification,
    },
  }),
  advanced: {
    database: {
      generateId: 'uuid',
    },
  },
  user: {
    additionalFields: {
      apiKeyHash: {
        type: 'string',
        required: false,
        input: false,
      },
      apiKeyExpiresAt: {
        type: 'date',
        required: false,
        input: false,
      },
    },
  },
  // Disable email and password authentication if CILogon is enabled
  emailAndPassword: {
    enabled: !authConfig.isCilogonEnabled,
  },
  plugins: authPlugins,
  databaseHooks: {
    user: {
      create: {
        before: async (newUser) => {
          if (newUser.name) {
            return;
          }

          const email = typeof newUser.email === 'string' ? newUser.email : '';
          return {
            data: {
              ...newUser,
              name: normalizeUserName(email),
            },
          };
        },
        after: async (createdUser) => {
          // After a new user is created, convert any pending deployment
          // invites for their email into AuthorizedUsers rows
          try {
            const email =
              typeof createdUser?.email === 'string' ? createdUser.email : '';
            const userId =
              typeof createdUser?.id === 'string' ? createdUser.id : '';
            if (!email || !userId) {
              return;
            }
            const { claimed, newlyGranted } =
              await claimPendingDeploymentInvitesForUser({
                userId,
                email,
              });
            if (claimed > 0) {
              console.info(
                `Claimed ${claimed} pending deployment invite${
                  claimed === 1 ? '' : 's'
                } for new user ${email}`,
              );
            }
            // Invitees who signed up after the deployment's lifecycle emails
            // went out would otherwise never hear about their access.
            for (const invite of newlyGranted) {
              await notifyDeploymentAccessGranted({
                deploymentId: invite.deploymentId,
                userId,
                sharedByUserId: invite.invitedBy,
              });
            }
          } catch (error) {
            console.error(
              'Failed to claim pending deployment invites for new user',
              error,
            );
          }
        },
      },
    },
  },
});

const handlers = toNextJsHandler(betterAuthInstance);

export const { GET, POST, PATCH, PUT, DELETE } = handlers;

function mapSession(
  sessionData: Awaited<ReturnType<typeof betterAuthInstance.api.getSession>>,
): AuthSession | null {
  if (!sessionData) {
    return null;
  }

  return {
    session: sessionData.session,
    user: sessionData.user as AuthUser,
  };
}

export async function auth(): Promise<AuthSession | null> {
  const requestHeaders = await headers();
  const sessionData = await betterAuthInstance.api.getSession({
    headers: requestHeaders,
  });

  return mapSession(sessionData);
}

export async function signOut({
  redirectTo,
}: {
  redirectTo?: string;
} = {}) {
  const requestHeaders = await headers();

  await betterAuthInstance.api.signOut({
    headers: requestHeaders,
  });

  if (redirectTo) {
    redirect(redirectTo);
  }
}

export function isBetterAuthApiError(error: unknown): error is APIError {
  return error instanceof APIError;
}
