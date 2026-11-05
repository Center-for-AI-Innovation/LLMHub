'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Braces, Check, Copy, TerminalSquare } from 'lucide-react';

import { useDeploymentModelType, type ModelDeployment } from '@/hooks/use-models';
import {
  ENDPOINTS,
  getEndpointKind,
  type SnippetLanguage,
} from '@/lib/public-api-snippets';
import { useGenerateApiKey } from '@/hooks/use-api-key';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
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
            <Check className={cn(iconSize, 'text-status-success')} />
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
  return `${origin}/api/public/v1/deployment/${deployment.id}`;
}

function getDeploymentDisplayLabel(
  deployment: ModelDeployment,
  labelSuffix: string | null,
) {
  const status = deployment.status.toUpperCase();
  return `${deployment.modelName} (${status}${labelSuffix ? ` · ${labelSuffix}` : ''})`;
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
  const [justGeneratedKey, setJustGeneratedKey] = useState<string | null>(
    null,
  );

  const { toast } = useToast();
  const generateApiKey = useGenerateApiKey();
  const getModelType = useDeploymentModelType();

  function getEndpoint(deployment: ModelDeployment) {
    return ENDPOINTS[getEndpointKind(getModelType(deployment))];
  }

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
  const endpoint = selectedDeployment
    ? getEndpoint(selectedDeployment)
    : ENDPOINTS.chatCompletions;

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
    () =>
      endpoint.build({
        baseUrl,
        authorizationHeader,
        apiKey: apiKeyValue,
        modelName: selectedModelName,
        prompt: userPromptValue,
        messages: requestMessages,
        stream: streamResponse,
      }),
    [
      endpoint,
      authorizationHeader,
      apiKeyValue,
      baseUrl,
      requestMessages,
      selectedModelName,
      streamResponse,
      userPromptValue,
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

  async function handleGenerate() {
    try {
      const result = await generateApiKey.mutateAsync();
      setApiKeyOverride(result.apiKey);
      setJustGeneratedKey(result.apiKey);
      toast({
        title: 'API key generated',
        description: 'Copy and store it securely. You will not see it again.',
      });
    } catch (error) {
      toast({
        title: 'Failed to generate API key',
        description:
          error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Dialog
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setApiKeyOverride('');
            setJustGeneratedKey(null);
          }
        }}
      >
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
                          {getDeploymentDisplayLabel(
                            deployment,
                            getEndpoint(deployment).labelSuffix,
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      API Key
                    </label>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-auto shrink-0 px-2 py-0 text-xs font-medium text-primary hover:bg-primary/10 hover:text-primary"
                          disabled={generateApiKey.isPending}
                        >
                          {generateApiKey.isPending
                            ? 'Generating...'
                            : 'Generate API Key'}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Generate API Key?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Generating will invalidate any previous keys.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={handleGenerate}
                            disabled={generateApiKey.isPending}
                          >
                            {generateApiKey.isPending
                              ? 'Generating...'
                              : 'Generate'}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                  <div className="relative">
                    <Input
                      value={apiKeyValue}
                      onChange={(event) => {
                        setApiKeyOverride(event.target.value);
                        setJustGeneratedKey(null);
                      }}
                      placeholder={DEFAULT_API_KEY}
                      className="h-9 pr-9 font-mono text-xs"
                    />
                    <div className="absolute inset-y-0 right-1 flex items-center">
                      <CopyButton
                        value={apiKeyValue}
                        label="API key"
                        onCopy={copyToClipboard}
                        size="sm"
                      />
                    </div>
                  </div>
                  {justGeneratedKey && (
                    <p className="text-xs text-destructive-accessible">
                      Your API key will disappear after closing this dialog.
                    </p>
                  )}
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
              {endpoint.requestEditor === 'input' ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Input
                  </label>
                  <Textarea
                    value={userPrompt}
                    onChange={(event) => setUserPrompt(event.target.value)}
                    className="min-h-[80px] resize-y font-mono text-xs leading-relaxed"
                    placeholder={DEFAULT_USER_PROMPT}
                  />
                </div>
              ) : (
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
              )}

              {/* ── Stream toggle ── */}
              {endpoint.supportsStreaming && (
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
              )}

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
                    <div className="h-[280px] overflow-auto">
                      <TabsContent value="curl" className="mt-0">
                        <pre className="max-w-full p-4 text-[13px] leading-relaxed text-foreground">
                          <code>{snippets.curl}</code>
                        </pre>
                      </TabsContent>
                      <TabsContent value="python" className="mt-0">
                        <pre className="max-w-full p-4 text-[13px] leading-relaxed text-foreground">
                          <code>{snippets.python}</code>
                        </pre>
                      </TabsContent>
                      <TabsContent value="javascript" className="mt-0">
                        <pre className="max-w-full p-4 text-[13px] leading-relaxed text-foreground">
                          <code>{snippets.javascript}</code>
                        </pre>
                      </TabsContent>
                    </div>
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
