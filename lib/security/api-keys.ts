import 'server-only';

import crypto from 'crypto';

import { getUserByApiKeyHash } from '@/lib/db/queries';

const PEPPER_MIN_LENGTH = 32;

// Gets the pepper from the environment variable and validates it
function getApiKeyPepper() {
  const pepper = process.env.USER_API_KEY_PEPPER;
  if (!pepper || pepper.trim().length < PEPPER_MIN_LENGTH) {
    throw new Error('USER_API_KEY_PEPPER must be at least 32 characters');
  }

  return pepper;
}

export function hashApiKey(value: string) {
  if (!value) {
    throw new Error('API key is required for hashing');
  }

  const hash = crypto
    .createHash('sha256')
    .update(value, 'utf8')
    .update(getApiKeyPepper(), 'utf8')
    .digest('hex');

  return { hash };
}

function isExpired(expiresAt: Date | null | undefined) {
  if (!expiresAt) {
    return true;
  }

  return expiresAt.getTime() <= Date.now();
}

export async function getUserFromApiKey(apiKey: string) {
  if (!apiKey || !apiKey.trim()) {
    return null;
  }

  const { hash } = hashApiKey(apiKey.trim());
  const user = await getUserByApiKeyHash(hash);

  if (!user || isExpired(user.apiKeyExpiresAt ?? null)) {
    return null;
  }

  return user;
}

export function extractBearerApiKey(authorizationHeader: string | null) {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
}
