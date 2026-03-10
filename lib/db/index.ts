import 'server-only';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

declare const globalThis: typeof global & {
  __llmHubPostgresClient?: ReturnType<typeof postgres>;
};

function getClient() {
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL is not set');
  }

  if (!globalThis.__llmHubPostgresClient) {
    globalThis.__llmHubPostgresClient = postgres(process.env.POSTGRES_URL);
  }

  return globalThis.__llmHubPostgresClient;
}

export const db = drizzle(getClient());
