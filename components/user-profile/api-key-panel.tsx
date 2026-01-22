'use client';

import { useMemo, useState } from 'react';
import { Copy, KeyRound, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { useGenerateApiKey } from '@/hooks/use-api-key';

type ApiKeyPanelProps = {
  hasApiKey: boolean;
  expiresAt: string | null;
};

export function ApiKeyPanel({ hasApiKey, expiresAt }: ApiKeyPanelProps) {
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [currentExpiresAt, setCurrentExpiresAt] = useState<string | null>(expiresAt);
  const [currentHasKey, setCurrentHasKey] = useState(hasApiKey);
  const { toast } = useToast();

  const generateApiKey = useGenerateApiKey();

  const formattedExpiry = useMemo(() => {
    if (!currentExpiresAt) return 'Not set';
    return new Date(currentExpiresAt).toLocaleString();
  }, [currentExpiresAt]);

  // Handle generating a new API key
  // A toast notification is shown to the user for succcess or failure
  const handleGenerate = async () => {
    try {
      const result = await generateApiKey.mutateAsync();
      setGeneratedKey(result.apiKey);
      setCurrentExpiresAt(result.expiresAt);
      setCurrentHasKey(true);
      toast({
        title: 'API key generated',
        description: 'Copy and store it securely. You will not see it again.',
      });
    } catch (error) {
      toast({
        title: 'Failed to generate API key',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  // Handle copying the API key to the clipboard
  // A toast notification lets user know if the copy was successful or not
  const handleCopy = async () => {
    if (!generatedKey) return;

    try {
      await navigator.clipboard.writeText(generatedKey);
      toast({ title: 'API key copied to clipboard' });
    } catch (error) {
      toast({
        title: 'Copy failed',
        description: 'Please copy the key manually.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5 text-primary" />
          API Key
        </CardTitle>
        <CardDescription>
          Generate an API key for model access. Regenerating invalidates the previous key.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          <div className="font-medium">
            Status: {currentHasKey ? 'Active' : 'Not generated'}
          </div>
          <div className="text-muted-foreground">Expires: {formattedExpiry}</div>
        </div>

        <Button
          type="button"
          onClick={handleGenerate}
          disabled={generateApiKey.isPending}
          className="w-full sm:w-auto"
        >
          {currentHasKey ? (
            <>
              <RotateCcw className="mr-2 size-4" />
              Regenerate API Key
            </>
          ) : (
            'Generate API Key'
          )}
        </Button>

        {generatedKey && (
          <div className="space-y-2">
            <div className="text-sm font-medium text-primary">
              Your new API key (shown once)
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input readOnly value={generatedKey} className="font-mono" />
              <Button type="button" variant="secondary" onClick={handleCopy}>
                <Copy className="mr-2 size-4" />
                Copy
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
