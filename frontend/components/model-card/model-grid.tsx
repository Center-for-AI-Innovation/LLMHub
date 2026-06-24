import { ModelCard } from './model-card';

const ModelGrid = ({ modelIds }: { modelIds: string[] }) => {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {modelIds.map((modelId) => (
        <ModelCard key={modelId} modelId={modelId} />
      ))}
    </div>
  );
};

export { ModelGrid };
