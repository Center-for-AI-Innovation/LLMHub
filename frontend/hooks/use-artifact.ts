'use client';

import useSWR from 'swr';
import type { UIArtifact } from '@/components/artifact';

export const initialArtifactData: UIArtifact = {
  documentId: 'init',
  content: '',
  kind: 'text',
  title: '',
  status: 'idle',
  isVisible: false,
  boundingBox: {
    top: 0,
    left: 0,
    width: 0,
    height: 0,
  },
};

type Selector<T> = (state: UIArtifact) => T;

export function useArtifactSelector<Selected>(selector: Selector<Selected>) {
  const { data: localArtifact } = useSWR<UIArtifact>('artifact', null, {
    fallbackData: initialArtifactData,
  });

  return selector(localArtifact ?? initialArtifactData);
}

export function useArtifact() {
  const { data: localArtifact, mutate: setLocalArtifact } = useSWR<UIArtifact>(
    'artifact',
    null,
    {
      fallbackData: initialArtifactData,
    },
  );

  const artifact = localArtifact ?? initialArtifactData;

  const setArtifact = (
    updaterFn: UIArtifact | ((currentArtifact: UIArtifact) => UIArtifact),
  ) => {
    setLocalArtifact((currentArtifact) => {
      const artifactToUpdate = currentArtifact || initialArtifactData;

      if (typeof updaterFn === 'function') {
        return updaterFn(artifactToUpdate);
      }

      return updaterFn;
    });
  };

  const { data: localArtifactMetadata, mutate: setLocalArtifactMetadata } =
    useSWR<any>(
      () =>
        artifact.documentId ? `artifact-metadata-${artifact.documentId}` : null,
      null,
      {
        fallbackData: null,
      },
    );

  return {
    artifact,
    setArtifact,
    metadata: localArtifactMetadata,
    setMetadata: setLocalArtifactMetadata,
  };
}
