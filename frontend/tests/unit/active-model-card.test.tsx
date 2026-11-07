// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActiveModelCard } from '@/components/model-card/active-model-card';
import type { ModelDeployment, ModelInfo } from '@/hooks/use-models';
import type { DeploymentStatusInfo } from '@/lib/models/deployment-status';

// The dialogs pull in data hooks that are irrelevant to the card's buttons.
vi.mock('@/components/public-api-dialog', () => ({
  PublicApiDialog: ({ trigger }: { trigger: React.ReactNode }) => trigger,
}));
vi.mock('@/components/share-deployment-dialog', () => ({
  ShareDeploymentDialog: () => null,
}));

const deployment = {
  id: 'dep-1',
  modelId: 'model-1',
  modelName: 'model-1',
  userId: 'user-1',
  slurmJobId: '1',
  status: 'ready',
} as ModelDeployment;

function renderCard(modelType: string | undefined) {
  const model = {
    id: 'model-1',
    modelName: 'model-1',
    description: '',
    status: 'warm',
    type: 'Small',
    family: 'family',
    variant: 'variant',
    modelType,
    specs: { gpus: 1, nodes: 1, contextLength: 4096, parallelism: false },
  } as ModelInfo;

  render(
    <ActiveModelCard
      model={model}
      getModelDeployment={() => deployment}
      getStatusInfo={() =>
        ({ label: 'Ready', colorClass: '', icon: () => null }) as unknown as DeploymentStatusInfo
      }
      handleStopModel={async () => {}}
      openLogsPanel={() => {}}
      stoppingDeploymentId={null}
      currentUserId="user-1"
    />,
  );
}

afterEach(cleanup);

describe('ActiveModelCard Chat button', () => {
  it.each(['LLM', 'VLM', undefined])('is shown for %s models', (modelType) => {
    renderCard(modelType);
    expect(screen.getByRole('link', { name: /chat/i })).toHaveProperty(
      'href',
      expect.stringContaining('/chat?deployment=dep-1'),
    );
  });

  it.each(['Text_Embedding', 'Reward_Modeling'])(
    'is hidden for %s models',
    (modelType) => {
      renderCard(modelType);
      expect(screen.queryByText(/chat/i)).toBeNull();
      expect(screen.getByRole('button', { name: 'API' })).toBeTruthy();
    },
  );
});
