'use client';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

export function RequestModelDialog() {
  const { toast } = useToast();

  function handleRequestClick() {
    toast({
      title: 'Coming soon',
      description: 'Requesting new model deployments will be available soon.',
    });
  }

  return (
    <Button
      size="lg"
      className="bg-secondary hover:bg-secondary/90"
      onClick={handleRequestClick}
    >
      Request New Model
    </Button>
  );
}
