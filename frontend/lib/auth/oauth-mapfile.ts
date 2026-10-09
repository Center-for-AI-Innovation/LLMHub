import { readFileSync, statSync } from 'node:fs';

/**
 * Delta oauth-mapfile lines look like:
 *   "user@ncsa.illinois.edu" netid
 * Only the quoted email (first column) is used for authorization.
 */
const MAPFILE_LINE_RE = /^"([^"]+)"\s+\S+/;

type MapfileCache = {
  path: string;
  mtimeMs: number;
  emails: Set<string>;
};

let cache: MapfileCache | null = null;

/**
 * Normalize a login email for oauth-mapfile lookup.
 *
 * Exact match against the first column for normal identities. Impersonation
 * test addresses such as `rohan13+svcllmhubrohan13@ncsa.illinois.edu` rewrite
 * to the suffix after `+` (same rule as model launch), so the mapfile entry
 * `"svcllmhubrohan13@ncsa.illinois.edu"` authorizes them.
 */
export function emailForOauthMapfileMatch(email: string): string {
  const trimmed = email.trim();
  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex <= 0) {
    return trimmed;
  }

  const localPart = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  const plusIndex = localPart.lastIndexOf('+');
  if (plusIndex === -1) {
    return trimmed;
  }

  const suffix = localPart.slice(plusIndex + 1).trim();
  if (!suffix) {
    return trimmed;
  }

  return `${suffix}@${domain}`;
}

export function parseOauthMapfileEmails(contents: string): Set<string> {
  const emails = new Set<string>();

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = MAPFILE_LINE_RE.exec(trimmed);
    if (!match?.[1]) {
      continue;
    }

    emails.add(match[1]);
  }

  return emails;
}

function loadOauthMapfileEmails(path: string): Set<string> {
  const mtimeMs = statSync(path).mtimeMs;
  if (cache?.path === path && cache.mtimeMs === mtimeMs) {
    return cache.emails;
  }

  const emails = parseOauthMapfileEmails(readFileSync(path, 'utf8'));
  cache = { path, mtimeMs, emails };
  return emails;
}

/**
 * Return true when `email` is listed in the mapfile first column (after
 * plus-address normalization). Fail closed if the file cannot be read.
 */
export function isEmailAuthorizedByOauthMapfile(
  email: string | null | undefined,
  mapfilePath: string,
): boolean {
  if (!email?.trim()) {
    return false;
  }

  const lookupEmail = emailForOauthMapfileMatch(email);

  try {
    return loadOauthMapfileEmails(mapfilePath).has(lookupEmail);
  } catch (error) {
    console.error(`[oauth-mapfile] Failed to read ${mapfilePath}`, error);
    return false;
  }
}

/** Test helper — clears the in-process mapfile cache. */
export function resetOauthMapfileCacheForTests() {
  cache = null;
}
