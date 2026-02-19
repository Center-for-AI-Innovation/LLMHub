'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Braces, Check, Copy, TerminalSquare } from 'lucide-react';

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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

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
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.';
const DEFAULT_USER_PROMPT = 'Hello from LLMHub';

function isActiveDeployment(deployment: ModelDeployment) {
  return ACTIVE_DEPLOYMENT_STATUSES.has(deployment.status.toLowerCase());
}

function CopyButton({
  value,
  label,
  onCopy,
  className,
  size = 'sm',
}: {
  value: string;
  label: string;
  onCopy: (value: string, label: string) => Promise<void>;
  className?: string;
  size?: 'sm' | 'lg';
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await onCopy(value, label);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const iconSize = size === 'sm' ? 'size-3.5' : 'size-4';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            'inline-flex items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground hover:bg-muted',
            size === 'sm' ? 'size-7' : 'size-8',
            className,
          )}
        >
          {copied ? (
            <Check className={cn(iconSize, 'text-emerald-500')} />
          ) : (
            <Copy className={iconSize} />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {copied ? 'Copied!' : `Copy ${label.toLowerCase()}`}
      </TooltipContent>
    </Tooltip>
  );
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
  const [selectedDeploymentOverride, setSelectedDeploymentOverride] =
    useState<string>('');
  const [apiKeyOverride, setApiKeyOverride] = useState<string>('');
  const [selectedLanguage, setSelectedLanguage] =
    useState<SnippetLanguage>('curl');
  const [systemPrompt, setSystemPrompt] = useState<string>(DEFAULT_SYSTEM_PROMPT);
  const [userPrompt, setUserPrompt] = useState<string>(DEFAULT_USER_PROMPT);
  const [streamResponse, setStreamResponse] = useState<boolean>(false);

  const { toast } = useToast();

  const activeDeployments = useMemo(
    () => deployments.filter((deployment) => isActiveDeployment(deployment)),
    [deployments],
  );

  const selectedDeployment = useMemo(() => {
    if (activeDeployments.length === 0) {
      return null;
    }

    if (selectedDeploymentOverride) {
      const selected = activeDeployments.find(
        (deployment) => deployment.id === selectedDeploymentOverride,
      );
      if (selected) {
        return selected;
      }
    }

    if (defaultDeploymentId) {
      const defaultSelected = activeDeployments.find(
        (deployment) => deployment.id === defaultDeploymentId,
      );
      if (defaultSelected) {
        return defaultSelected;
      }
    }

    return activeDeployments[0];
  }, [activeDeployments, defaultDeploymentId, selectedDeploymentOverride]);

  const resolvedOrigin =
    typeof window !== 'undefined' ? window.location.origin : DEFAULT_HOST;
  const apiKeyValue = apiKeyOverride || defaultApiKey || DEFAULT_API_KEY;
  const baseUrl = selectedDeployment
    ? getPublicApiBaseUrl(resolvedOrigin, selectedDeployment)
    : '';
  const selectedModelName = selectedDeployment?.modelName || DEFAULT_MODEL_NAME;
  const authorizationHeader = `Bearer ${apiKeyValue || DEFAULT_API_KEY}`;
  const userPromptValue = userPrompt.length > 0 ? userPrompt : DEFAULT_USER_PROMPT;

  const requestMessages = useMemo(() => {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];

    if (systemPrompt.trim().length > 0) {
      messages.push({
        role: 'system',
        content: systemPrompt,
      });
    }

    messages.push({
      role: 'user',
      content: userPromptValue,
    });

    return messages;
  }, [systemPrompt, userPromptValue]);

  const snippets = useMemo(
    () => ({
      curl: `curl -X POST "${baseUrl}/chat/completions" \\
  -H "Authorization: ${authorizationHeader}" \\
  -H "Content-Type: application/json" \\
  -d @- <<'JSON'
${JSON.stringify(
  {
    model: selectedModelName,
    messages: requestMessages,
    stream: streamResponse,
  },
  null,
  2,
)}
JSON`,
      python: `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}",
    api_key="${apiKeyValue || DEFAULT_API_KEY}",
)

messages = ${JSON.stringify(requestMessages, null, 4)}

if ${streamResponse ? 'True' : 'False'}:
    stream = client.chat.completions.create(
        model="${selectedModelName}",
        messages=messages,
        stream=True,
    )

    for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            print(delta, end="")
    print()
else:
    response = client.chat.completions.create(
        model="${selectedModelName}",
        messages=messages,
        stream=False,
    )

    print(response.choices[0].message.content)`,
      javascript: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${baseUrl}",
  apiKey: "${apiKeyValue || DEFAULT_API_KEY}",
});

const messages = ${JSON.stringify(requestMessages, null, 2)};

if (${streamResponse ? 'true' : 'false'}) {
  const stream = await client.chat.completions.create({
    model: "${selectedModelName}",
    messages,
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) process.stdout.write(delta);
  }
  process.stdout.write("\\n");
} else {
  const response = await client.chat.completions.create({
    model: "${selectedModelName}",
    messages,
    stream: false,
  });

  console.log(response.choices[0]?.message?.content);
}`,
    }),
    [
      authorizationHeader,
      apiKeyValue,
      baseUrl,
      requestMessages,
      selectedModelName,
      streamResponse,
    ],
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
    <TooltipProvider delayDuration={200}>
      <Dialog>
        <DialogTrigger asChild>
          {trigger ?? (
            <Button type="button" variant="outline">
              <TerminalSquare className="mr-2 size-4" />
              API
            </Button>
          )}
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto overflow-x-hidden p-0 sm:max-w-3xl">
          {/* ── Header ── */}
          <div className="border-b px-6 pb-4 pt-6">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10">
                  <Braces className="size-3.5 text-primary" />
                </div>
                API
              </DialogTitle>
              <DialogDescription className="text-xs">
                OpenAI-compatible endpoints for your deployed models.
              </DialogDescription>
            </DialogHeader>
          </div>

          {activeDeployments.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">
              No active deployments found. Deploy a model to see API examples.
            </div>
          ) : (
            <div className="min-w-0 space-y-5 overflow-hidden px-6 py-5">
              {/* ── Connection ── */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Deployment
                  </label>
                  <Select
                    value={selectedDeployment?.id || ''}
                    onValueChange={setSelectedDeploymentOverride}
                  >
                    <SelectTrigger className="h-9 text-sm">
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

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    API Key
                  </label>
                  <div className="relative">
                    <Input
                      value={apiKeyValue}
                      onChange={(event) => setApiKeyOverride(event.target.value)}
                      placeholder={DEFAULT_API_KEY}
                      className="h-9 pr-9 font-mono text-xs"
                    />
                    <div className="absolute inset-y-0 right-1 flex items-center">
                      <CopyButton
                        value={authorizationHeader}
                        label="Authorization header"
                        onCopy={copyToClipboard}
                        size="sm"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Base URL ── */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Base URL
                </label>
                <div className="relative">
                  <Input
                    readOnly
                    value={baseUrl}
                    className="h-9 cursor-default bg-muted/40 pr-9 font-mono text-xs"
                  />
                  <div className="absolute inset-y-0 right-1 flex items-center">
                    <CopyButton
                      value={baseUrl}
                      label="Base URL"
                      onCopy={copyToClipboard}
                      size="sm"
                    />
                  </div>
                </div>
              </div>

              {/* ── Section divider ── */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-start">
                  <span className="bg-background pr-3 text-xs font-medium text-muted-foreground">
                    Request
                  </span>
                </div>
              </div>

              {/* ── Prompts ── */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    System prompt
                  </label>
                  <Textarea
                    value={systemPrompt}
                    onChange={(event) => setSystemPrompt(event.target.value)}
                    className="min-h-[80px] resize-y font-mono text-xs leading-relaxed"
                    placeholder={DEFAULT_SYSTEM_PROMPT}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    User prompt
                  </label>
                  <Textarea
                    value={userPrompt}
                    onChange={(event) => setUserPrompt(event.target.value)}
                    className="min-h-[80px] resize-y font-mono text-xs leading-relaxed"
                    placeholder={DEFAULT_USER_PROMPT}
                  />
                </div>
              </div>

              {/* ── Stream toggle ── */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={streamResponse}
                  aria-label="Toggle stream mode"
                  onClick={() => setStreamResponse((prev) => !prev)}
                  className={cn(
                    'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    streamResponse ? 'bg-primary' : 'bg-muted',
                  )}
                >
                  <span
                    className={cn(
                      'pointer-events-none block size-3.5 rounded-full bg-background shadow-sm ring-0 transition-transform',
                      streamResponse ? 'translate-x-4' : 'translate-x-0.5',
                    )}
                  />
                </button>
                <span className="text-xs font-medium text-muted-foreground">
                  Stream Response
                </span>
              </div>

              {/* ── Code snippets ── */}
              <Tabs
                value={selectedLanguage}
                onValueChange={(value) =>
                  setSelectedLanguage(value as SnippetLanguage)
                }
                className="min-w-0 w-full"
              >
                <div className="min-w-0 overflow-hidden rounded-lg border border-border/60">
                  {/* Toolbar */}
                  <div className="flex items-center justify-between border-b bg-muted/30 p-1">
                    <TabsList className="h-auto gap-0.5 bg-transparent p-0">
                      <TabsTrigger
                        value="curl"
                        className="h-7 rounded-md px-3 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"
                      >
                        curl
                      </TabsTrigger>
                      <TabsTrigger
                        value="python"
                        className="h-7 rounded-md px-3 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"
                      >
                        Python
                      </TabsTrigger>
                      <TabsTrigger
                        value="javascript"
                        className="h-7 rounded-md px-3 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"
                      >
                        JavaScript
                      </TabsTrigger>
                    </TabsList>
                    <CopyButton
                      value={currentSnippet}
                      label={`${selectedLanguage} snippet`}
                      onCopy={copyToClipboard}
                      size="sm"
                      className="mr-1"
                    />
                  </div>

                  {/* Code */}
                  <div className="min-w-0 overflow-hidden bg-muted/40">
                    <TabsContent value="curl" className="mt-0">
                      <pre className="max-w-full overflow-x-auto p-4 text-[13px] leading-relaxed text-foreground">
                        <code>{snippets.curl}</code>
                      </pre>
                    </TabsContent>
                    <TabsContent value="python" className="mt-0">
                      <pre className="max-w-full overflow-x-auto p-4 text-[13px] leading-relaxed text-foreground">
                        <code>{snippets.python}</code>
                      </pre>
                    </TabsContent>
                    <TabsContent value="javascript" className="mt-0">
                      <pre className="max-w-full overflow-x-auto p-4 text-[13px] leading-relaxed text-foreground">
                        <code>{snippets.javascript}</code>
                      </pre>
                    </TabsContent>
                  </div>
                </div>
              </Tabs>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
