import { auth } from '@/app/(auth)/auth';
import {
  addUserToDeployment,
  getAuthorizedUsersByDeploymentId,
  getModelDeploymentById,
  getUserByEmail,
} from '@/lib/db/queries';
import type { ShareDeploymentResultEntry } from '@/lib/models/deployment-sharing';
import { notifyDeploymentAccessGranted } from '@/lib/models/notify-deployment-access';
import { type NextRequest, NextResponse } from 'next/server';

// regex for email validation
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ShareResultEntry = ShareDeploymentResultEntry;

function normalizeEmails(input: unknown): string[] {
  // returns an array of unique, trimmed, non-empty email strings
  if (!input) return [];
  if (typeof input === 'string') {
    return input
      .split(/[\s,;]+/)
      .map((value) => value.trim())
      .filter(Boolean);
  }
  if (Array.isArray(input)) {
    return input
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return [];
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ deploymentId: string }> },
) {
  try {
    const session = await auth();
    const sessionUser = session?.user as unknown as
      | { id?: string; email?: string | null }
      | undefined;
    const userId = sessionUser?.id;

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { deploymentId } = await params;

    const deployment = await getModelDeploymentById(deploymentId);
    if (!deployment) {
      return NextResponse.json(
        { error: 'Deployment not found' },
        { status: 404 },
      );
    }

    // Sharing metadata is available only for deployment owners.
    if (deployment.userId !== userId) {
      return NextResponse.json(
        { error: 'Only the deployment owner can view sharing settings.' },
        { status: 403 },
      );
    }

    const authorized = await getAuthorizedUsersByDeploymentId(deploymentId);

    return NextResponse.json({
      authorizedUsers: authorized,
    });
  } catch (error) {
    console.error('Error fetching authorized users for deployment:', error);
    return NextResponse.json(
      { error: 'Failed to load authorized users.' },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ deploymentId: string }> },
) {
  try {
    const session = await auth();
    const sessionUser = session?.user as unknown as
      | { id?: string; email?: string | null }
      | undefined;
    const userId = sessionUser?.id;

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { deploymentId } = await params;
    const body = await request.json().catch(() => ({}));
    const emails = normalizeEmails((body as { emails?: unknown }).emails);

    if (emails.length === 0) {
      return NextResponse.json(
        { error: 'At least one email is required.' },
        { status: 400 },
      );
    }

    const deployment = await getModelDeploymentById(deploymentId);
    if (!deployment) {
      return NextResponse.json(
        { error: 'Deployment not found' },
        { status: 404 },
      );
    }

    // Only the owner of the deployment may share it.
    if (deployment.userId !== userId) {
      return NextResponse.json(
        { error: 'Only the deployment owner can share access.' },
        { status: 403 },
      );
    }

    const existing = await getAuthorizedUsersByDeploymentId(deploymentId);
    const existingUserIds = new Set(existing.map((row) => row.userId));

    const seen = new Set<string>();
    const results: ShareResultEntry[] = [];

    for (const rawEmail of emails) {
      const email = rawEmail.trim();
      if (seen.has(email)) {
        continue;
      }
      seen.add(email);

      if (!EMAIL_REGEX.test(email)) {
        results.push({
          email,
          status: 'invalid',
          message: 'Not a valid email address.',
        });
        continue;
      }

      try {
        const targetUser = await getUserByEmail(email);
        if (!targetUser) {
          // Access is only ever granted to an existing account. The owner has
          // to ask them to sign up first, then share again.
          results.push({
            email,
            status: 'not_registered',
            message:
              'No LLMHub account exists for this email. Ask them to sign up, then share again.',
          });
          continue;
        }

        if (existingUserIds.has(targetUser.id)) {
          results.push({ email, status: 'already_shared' });
          continue;
        }

        await addUserToDeployment({
          deploymentId,
          userId: targetUser.id,
          permission: 'user',
        });
        existingUserIds.add(targetUser.id);
        results.push({ email, status: 'added' });

        // Access is already granted at this point; the helper logs and
        // swallows failures so a broken email path never fails the share.
        await notifyDeploymentAccessGranted({
          deploymentId,
          userId: targetUser.id,
          sharedByUserId: userId,
        });
      } catch (error) {
        const errorCode =
          typeof error === 'object' && error !== null && 'code' in error
            ? (error as { code?: string }).code
            : undefined;

        // Postgres unique_violation – the user already had access.
        if (errorCode === '23505') {
          results.push({ email, status: 'already_shared' });
          continue;
        }

        console.error('Failed to authorize email', email, error);
        results.push({
          email,
          status: 'failed',
          message: 'Could not share with this user.',
        });
      }
    }

    const summary = {
      added: results.filter((r) => r.status === 'added').length,
      alreadyShared: results.filter((r) => r.status === 'already_shared')
        .length,
      notRegistered: results.filter((r) => r.status === 'not_registered')
        .length,
      invalid: results.filter((r) => r.status === 'invalid').length,
      failed: results.filter((r) => r.status === 'failed').length,
    };

    return NextResponse.json({ results, summary });
  } catch (error) {
    console.error('Error sharing deployment:', error);
    return NextResponse.json(
      { error: 'Failed to share deployment.' },
      { status: 500 },
    );
  }
}
