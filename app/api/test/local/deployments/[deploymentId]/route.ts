import {
  getModelDeploymentById,
  shutdownModelDeploymentById,
} from '@/lib/db/queries';
import { NextResponse } from 'next/server';

function isDevelopment() {
  return process.env.NODE_ENV === 'development';
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ deploymentId: string }> },
) {
  try {
    if (!isDevelopment()) {
      return NextResponse.json(
        { error: 'Local test deployments are only available in development mode.' },
        { status: 501 },
      );
    }

    const { deploymentId } = await params;
    await shutdownModelDeploymentById(deploymentId);
    return NextResponse.json(
      { message: 'Local test deployment shutdown successfully' },
      { status: 200 },
    );
  } catch (error) {
    console.error('Error shutting down local test deployment:', error);
    return NextResponse.json(
      { error: 'Failed to shut down local test deployment' },
      { status: 500 },
    );
  }
}

export async function GET(
  _: Request,
  { params }: { params: Promise<{ deploymentId: string }> },
) {
  try {
    if (!isDevelopment()) {
      return NextResponse.json(
        { error: 'Local test deployments are only available in development mode.' },
        { status: 501 },
      );
    }

    const { deploymentId } = await params;
    const deployment = await getModelDeploymentById(deploymentId);

    if (!deployment) {
      return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    return NextResponse.json(deployment);
  } catch (error) {
    console.error('Error fetching local test deployment:', error);
    return NextResponse.json(
      { error: 'Failed to fetch local test deployment' },
      { status: 500 },
    );
  }
}
