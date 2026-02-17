import { shutdownModelDeploymentById } from '@/lib/db/queries';
import { NextResponse } from 'next/server';

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ deploymentId: string }> }
) {
  try {
    const { deploymentId } = await params;
    await shutdownModelDeploymentById(deploymentId);
    return NextResponse.json({ message: 'Deployment shutdown successfully' }, { status: 200 });
  } catch (error) {
    console.error('Error shutting down deployment:', error);
    return NextResponse.json({ error: 'Failed to shut down deployment' }, { status: 500 });
  }
}