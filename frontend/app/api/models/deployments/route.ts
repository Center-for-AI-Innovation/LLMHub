import { auth } from '@/app/(auth)/auth';
import { getAccessibleDeploymentsByUserId } from '@/lib/db/queries';
import { NextResponse } from 'next/server';

function parseStatusFilter(rawStatus: string | null): Set<string> {
  if (!rawStatus) {
    return new Set();
  }

  return new Set(
    rawStatus
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function GET(request: Request) {
  try {
    const session = await auth();
    const sessionUser = session?.user as unknown as
      | { id?: string; email?: string | null }
      | undefined;
    const userId = sessionUser?.id;

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const statusFilter = parseStatusFilter(url.searchParams.get('status'));
    const deployments = await getAccessibleDeploymentsByUserId(userId);

    if (statusFilter.size === 0) {
      return NextResponse.json(deployments);
    }

    const filteredDeployments = deployments.filter((deployment) =>
      statusFilter.has(deployment.status.toLowerCase()),
    );
    return NextResponse.json(filteredDeployments);
  } catch (error) {
    console.error('Error fetching model deployments:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch deployments.',
      },
      { status: 503 },
    );
  }
}
