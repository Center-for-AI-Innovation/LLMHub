import { useState, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { VirtualizedModelCard } from './virtualized-model-card';

// Virtualized grid that only renders visible items
const VirtualizedModelGrid = ({ modelIds }: { modelIds: string[] }) => {
  const [visibleStart, setVisibleStart] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Initial render only shows first 8 models (or fewer if less available)
  const itemsToShow = Math.min(8, modelIds.length);
  
  // Set up intersection observer to load more items when user scrolls
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting && visibleStart + itemsToShow < modelIds.length) {
          setVisibleStart((prev) =>
            Math.min(prev + 8, Math.max(0, modelIds.length - 8)),
          );
        }
      },
      { threshold: 0.1 }
    );
    
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    
    return () => observer.disconnect();
  }, [visibleStart, itemsToShow, modelIds.length]);
  
  // Get visible model IDs
  const visibleModelIds = modelIds.slice(0, visibleStart + itemsToShow);
  
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {visibleModelIds.map(modelId => (
        <VirtualizedModelCard key={modelId} modelId={modelId} />
      ))}
      {visibleStart + itemsToShow < modelIds.length && (
        <div ref={containerRef} className="h-[340px] flex items-center justify-center">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
};

export { VirtualizedModelGrid }; 
