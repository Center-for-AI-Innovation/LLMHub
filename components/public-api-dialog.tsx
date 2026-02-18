'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Braces, Copy, KeyRound, TerminalSquare } from 'lucide-react';

import type { ModelDeployment } from '@/hooks/use-models';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type PublicApiDialogProps = {
  deployments: ModelDeployment[];
  defaultDeploymentId?: string;
  defaultApiKey?: string;
  trigger?: ReactNode;
};

type SnippetLanguage = 'curl' | 'python' | 'javascript';

const ACTIVE_DEPLOYMENT_STATUSES = new Set(['ready', 'running']);
const DEFAULT_HOST = 'https://your-llmhub-host.example.com';
const DEFAULT_API_KEY = 'YOUR_LLMHUB_API_KEY';
const DEFAULT_MODEL_NAME = 'YOUR_MODEL_NAME';

function isActiveDeployment(deployment: ModelDeployment) {
  return ACTIVE_DEPLOYMENT_STATUSES.has(deployment.status.toLowerCase());
}

function getPublicApiBaseUrl(origin: string, deployment: ModelDeployment) {
  return `${origin}/api/public/v1/job/${deployment.slurmJobId}`;
}

function getDeploymentDisplayLabel(deployment: ModelDeployment) {
  const status = deployment.status.toUpperCase();
  return `${deployment.modelName} (${status})`;
}

export function PublicApiDialog({
  deployments,
  defaultDeploymentId,
  defaultApiKey,
  trigger,
}: PublicApiDialogProps) {
  const [hostOrigin, setHostOrigin] = useState('');
  const [selectedDeploymentId, setSelectedDeploymentId] = useState('');
  const [apiKeyValue, setApiKeyValue] = useState(
    defaultApiKey || DEFAULT_API_KEY,
  );
  const [selectedLanguage, setSelectedLanguage] =
    useState<SnippetLanguage>('curl');

  const { toast } = useToast();

  const activeDeployments = useMemo(
    () => deployments.filter((deployment) => isActiveDeployment(deployment)),
    [deployments],
  );

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setHostOrigin(window.location.origin);
    }
  }, []);

  useEffect(() => {
    if (defaultApiKey) {
      setApiKeyValue(defaultApiKey);
    }
  }, [defaultApiKey]);

  useEffect(() => {
    if (activeDeployments.length === 0) {
      setSelectedDeploymentId('');
      return;
    }

    if (
      defaultDeploymentId &&
      activeDeployments.some(
        (deployment) => deployment.id === defaultDeploymentId,
      )
    ) {
      setSelectedDeploymentId(defaultDeploymentId);
      return;
    }

    if (
      selectedDeploymentId &&
      activeDeployments.some(
        (deployment) => deployment.id === selectedDeploymentId,
      )
    ) {
      return;
    }

    setSelectedDeploymentId(activeDeployments[0].id);
  }, [activeDeployments, defaultDeploymentId, selectedDeploymentId]);

  const selectedDeployment = useMemo(() => {
    if (!selectedDeploymentId) {
      return activeDeployments[0] ?? null;
    }

    return (
      activeDeployments.find(
        (deployment) => deployment.id === selectedDeploymentId,
      ) ?? activeDeployments[0] ?? null
    );
  }, [activeDeployments, selectedDeploymentId]);

  const resolvedOrigin = hostOrigin || DEFAULT_HOST;
  const baseUrl = selectedDeployment
    ? getPublicApiBaseUrl(resolvedOrigin, selectedDeployment)
    : '';
  const selectedModelName = selectedDeployment?.modelName || DEFAULT_MODEL_NAME;
  const authorizationHeader = `Bearer ${apiKeyValue || DEFAULT_API_KEY}`;

  const snippets = useMemo(
    () => ({
      curl: `curl -X POST "${baseUrl}/chat/completions" \\
  -H "Authorization: ${authorizationHeader}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${selectedModelName}",
    "messages": [
      { "role": "user", "content": "Hello from cURL" }
    ]
  }'`,
      python: `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}",
    api_key="${apiKeyValue || DEFAULT_API_KEY}",
)

response = client.chat.completions.create(
    model="${selectedModelName}",
    messages=[{"role": "user", "content": "Hello from Python"}],
)

print(response.choices[0].message.content)`,
      javascript: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${baseUrl}",
  apiKey: "${apiKeyValue || DEFAULT_API_KEY}",
});

const response = await client.chat.completions.create({
  model: "${selectedModelName}",
  messages: [{ role: "user", content: "Hello from JavaScript" }],
});

console.log(response.choices[0]?.message?.content);`,
    }),
    [authorizationHeader, apiKeyValue, baseUrl, selectedModelName],
  );

  const currentSnippet = snippets[selectedLanguage];

  async function copyToClipboard(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast({
        title: `${label} copied`,
      });
    } catch (_error) {
      toast({
        title: 'Copy failed',
        description: 'Please copy manually.',
        variant: 'destructive',
      });
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="outline">
            <TerminalSquare className="mr-2 size-4" />
            API
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Braces className="size-5 text-primary" />
            API
          </DialogTitle>
          <DialogDescription>
            Use your API key with deployed models via OpenAI-compatible endpoints.
          </DialogDescription>
        </DialogHeader>

        {activeDeployments.length === 0 ? (
          <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
            No active deployments found. Start a model deployment to generate API examples.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <div className="text-sm font-medium">Deployment</div>
                <Select
                  value={selectedDeployment?.id || ''}
                  onValueChange={setSelectedDeploymentId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select deployment" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeDeployments.map((deployment) => (
                      <SelectItem key={deployment.id} value={deployment.id}>
                        {getDeploymentDisplayLabel(deployment)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">API key</div>
                <div className="flex gap-2">
                  <Input
                    value={apiKeyValue}
                    onChange={(event) => setApiKeyValue(event.target.value)}
                    placeholder={DEFAULT_API_KEY}
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      copyToClipboard(authorizationHeader, 'Authorization header')
                    }
                  >
                    <KeyRound className="mr-2 size-4" />
                    Copy
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Base URL</div>
              <div className="flex gap-2">
                <Input readOnly value={baseUrl} className="font-mono text-xs" />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => copyToClipboard(baseUrl, 'Base URL')}
                >
                  <Copy className="mr-2 size-4" />
                  Copy
                </Button>
              </div>
            </div>

            <Tabs
              value={selectedLanguage}
              onValueChange={(value) =>
                setSelectedLanguage(value as SnippetLanguage)
              }
              className="w-full"
            >
              <div className="flex items-center justify-between gap-2">
                <TabsList>
                  <TabsTrigger value="curl">curl</TabsTrigger>
                  <TabsTrigger value="python">Python</TabsTrigger>
                  <TabsTrigger value="javascript">JavaScript</TabsTrigger>
                </TabsList>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    copyToClipboard(currentSnippet, `${selectedLanguage} example`)
                  }
                >
                  <Copy className="mr-2 size-4" />
                  Copy Example
                </Button>
              </div>

              <TabsContent value="curl">
                <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-4 text-xs leading-relaxed">
                  <code>{snippets.curl}</code>
                </pre>
              </TabsContent>
              <TabsContent value="python">
                <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-4 text-xs leading-relaxed">
                  <code>{snippets.python}</code>
                </pre>
              </TabsContent>
              <TabsContent value="javascript">
                <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-4 text-xs leading-relaxed">
                  <code>{snippets.javascript}</code>
                </pre>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
