import { getModelDeploymentById } from '@/lib/db/queries';
import { NextResponse } from 'next/server';

function isDevelopment() {
  return process.env.NODE_ENV === 'development';
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

    return NextResponse.json({
      success: true,
      logs: {
        stderr: ['[local-test] no stderr logs available'],
        stdout: ['[local-test] deployment created in local mode'],
      },
      deployment: {
        id: deployment.id,
        status: deployment.status,
        modelName: deployment.modelName,
        slurmJobId: deployment.slurmJobId,
        errorMessage: deployment.errorMessage,
      },
      logFiles: {
        stderr: '',
        stdout: '',
      },
    });
  } catch (error) {
    console.error('Error fetching local test deployment logs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch local test deployment logs' },
      { status: 500 },
    );
  }
}
