import { NextResponse } from 'next/server';
import crypto from 'crypto';

import { auth } from '@/app/(auth)/auth';
import { updateUserApiKey } from '@/lib/db/queries';
import { hashApiKey } from '@/lib/security/api-keys';

const API_KEY_BYTE_LENGTH = 32;
const API_KEY_TTL_DAYS = 30;

function generateApiKey() {
  return `llmhub_${crypto
    .randomBytes(API_KEY_BYTE_LENGTH)
    .toString('base64url')}`;
}

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const apiKey = generateApiKey();
    const { hash: apiKeyHash } = hashApiKey(apiKey);
    const apiKeyExpiresAt = new Date(
      Date.now() + API_KEY_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    await updateUserApiKey({
      userId: session.user.id,
      apiKeyHash,
      apiKeyExpiresAt,
    });

    return NextResponse.json({
      apiKey,
      expiresAt: apiKeyExpiresAt.toISOString(),
    });
  } catch (error) {
    console.error('[API Key] Failed to generate API key', error);
    return NextResponse.json(
      { error: 'Failed to generate API key' },
      { status: 500 },
    );
  }
}
