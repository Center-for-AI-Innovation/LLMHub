export const DEFAULT_APP_URL = 'http://localhost:3000';
export const DEFAULT_CILOGON_DISCOVERY_URL =
  'https://cilogon.org/.well-known/openid-configuration';
export const DEFAULT_CILOGON_SKIN = 'illinois-chat';
const DEFAULT_LOCAL_ALLOWED_HOSTS = [
  'localhost:3000',
  '127.0.0.1:3000',
  'localhost:3001',
  '127.0.0.1:3001'
] as const;

export function getBaseURL() {
  return process.env.BETTER_AUTH_URL || DEFAULT_APP_URL;
}

export function isCilogonEnabled() {
  return Boolean(
    process.env.CILOGON_CLIENT_ID && process.env.CILOGON_CLIENT_SECRET,
  );
}

export function getAllowedAuthHosts() {
  const configuredHost = new URL(getBaseURL()).host;
  return Array.from(new Set([...DEFAULT_LOCAL_ALLOWED_HOSTS, configuredHost]));
}
