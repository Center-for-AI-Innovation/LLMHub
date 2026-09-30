import { auth } from '@/app/(auth)/auth';
import { clusterUsernameFromEmail } from '@/lib/cluster-username';
import { type NextResponse as NextResponseType } from 'next/server';
import { NextResponse } from 'next/server';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8000';

export interface SlurmAccounts {
  accounts: string[];
  defaultAccount: string | null;
}

export async function GET(): Promise<NextResponseType> {
  const session = await auth();
  const sessionUser = session?.user as unknown as
    | { id?: string; email?: string | null }
    | undefined;

  if (!sessionUser?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const clusterUsername = clusterUsernameFromEmail(sessionUser.email);
  if (!clusterUsername) {
    return NextResponse.json(
      {
        error:
          'Could not determine your cluster username from the signed-in email.',
      },
      { status: 400 },
    );
  }

  const backendUrl = new URL(`${BACKEND_API_URL}/api/models/slurm-accounts`);
  backendUrl.searchParams.set('clusterUsername', clusterUsername);

  const res = await fetch(backendUrl.toString(), { cache: 'no-store' });
  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    let parsedMessage = errorText;
    try {
      const parsed = JSON.parse(errorText) as {
        error?: unknown;
        detail?: unknown;
      };
      const candidate =
        (typeof parsed.error === 'string' && parsed.error) ||
        (typeof parsed.detail === 'string' && parsed.detail);
      if (candidate) {
        parsedMessage = candidate;
      }
    } catch {
      // Keep raw text when the backend body is not JSON.
    }

    return NextResponse.json(
      {
        error:
          parsedMessage ||
          `Failed to fetch Slurm accounts: ${res.status} ${res.statusText}`,
      },
      { status: res.status },
    );
  }

  const data: SlurmAccounts = await res.json();
  return NextResponse.json({
    accounts: Array.isArray(data.accounts) ? data.accounts : [],
    defaultAccount: data.defaultAccount ?? null,
  });
}
