'use client';

import {
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from 'react';
import { Loader2, X, Share2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { type ShareDeploymentResultEntry } from '@/lib/models/deployment-sharing';
import { useShareDeployment } from '@/hooks/use-models';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STATUS_LABEL: Record<ShareDeploymentResultEntry['status'], string> = {
  added: 'Access granted',
  already_shared: 'Already had access',
  invited: 'Invited (pending signup)',
  already_invited: 'Already invited',
  invalid: 'Invalid email',
  failed: 'Failed',
};

const STATUS_TONE: Record<ShareDeploymentResultEntry['status'], string> = {
  added: 'text-emerald-600 dark:text-emerald-400',
  already_shared: 'text-muted-foreground',
  invited: 'text-sky-600 dark:text-sky-400',
  already_invited: 'text-muted-foreground',
  invalid: 'text-amber-600 dark:text-amber-400',
  failed: 'text-destructive',
};

type ShareDeploymentDialogProps = {
  deploymentId: string | undefined;
  modelName: string;
  trigger?: ReactNode;
  disabled?: boolean;
};

export function ShareDeploymentDialog({
  deploymentId,
  modelName,
  trigger,
  disabled = false,
}: ShareDeploymentDialogProps) {
  const { toast } = useToast();
  const { mutateAsync: shareDeployment, isPending } = useShareDeployment();

  const [open, setOpen] = useState(false);
  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ShareDeploymentResultEntry[] | null>(
    null,
  );

  useEffect(() => {
    if (!open) {
      // Reset transient state when the dialog closes.
      setDraft('');
      setEmails([]);
      setError(null);
      setResults(null);
    }
  }, [open]);

  const hasEmails = emails.length > 0;
  const canSubmit = useMemo(
    () => Boolean(deploymentId) && hasEmails && !isPending && !disabled,
    [deploymentId, hasEmails, isPending, disabled],
  );

  function commitDraft(value: string) {
    const candidates = value
      .split(/[\s,;]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (candidates.length === 0) {
      return;
    }

    setEmails((current) => {
      const next = [...current];
      const seen = new Set(current);
      let invalidFound: string | null = null;

      for (const candidate of candidates) {
        if (seen.has(candidate)) continue;
        if (!EMAIL_REGEX.test(candidate)) {
          invalidFound = candidate;
          continue;
        }
        seen.add(candidate);
        next.push(candidate);
      }

      setError(
        invalidFound ? `"${invalidFound}" is not a valid email address.` : null,
      );

      return next;
    });
  }

  function handleAddCurrentDraft() {
    if (draft.trim().length === 0) {
      return;
    }
    commitDraft(draft);
    setDraft('');
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',' || event.key === ' ') {
      if (draft.trim().length > 0) {
        event.preventDefault();
        handleAddCurrentDraft();
      }
    } else if (event.key === 'Backspace' && draft === '' && emails.length > 0) {
      // Convenience: pop the last email when backspacing into an empty input.
      setEmails((current) => current.slice(0, -1));
    }
  }

  function removeEmail(target: string) {
    setEmails((current) => current.filter((email) => email !== target));
  }

  async function handleSubmit() {
    if (!deploymentId) {
      setError('No deployment selected.');
      return;
    }

    // Make sure any text still in the input gets submitted too.
    const pending = draft.trim();
    let pendingEmails = emails;
    if (pending.length > 0) {
      if (!EMAIL_REGEX.test(pending)) {
        setError(`"${pending}" is not a valid email address.`);
        return;
      }
      pendingEmails = Array.from(
        new Set([...emails, pending].map((value) => value.trim())),
      );
      setEmails(pendingEmails);
      setDraft('');
    }

    if (pendingEmails.length === 0) {
      setError('Add at least one email to share access with.');
      return;
    }

    setError(null);

    try {
      const response = await shareDeployment({
        deploymentId,
        emails: pendingEmails,
      });
      setResults(response.results);

      const {
        added,
        alreadyShared,
        invited,
        alreadyInvited,
        invalid,
        failed,
      } = response.summary;

      const grantedSummary: string[] = [];
      if (added > 0) {
        grantedSummary.push(
          `${added} user${added === 1 ? '' : 's'} added`,
        );
      }
      if (invited > 0) {
        grantedSummary.push(
          `${invited} email${
            invited === 1 ? '' : 's'
          } invited (pending signup)`,
        );
      }

      if (grantedSummary.length > 0) {
        toast({
          title: 'Access updated',
          description: `${grantedSummary.join(', ')} for "${modelName}".`,
        });
      }

      const issues = invalid + failed;
      if (
        added === 0 &&
        invited === 0 &&
        (alreadyShared > 0 || alreadyInvited > 0) &&
        issues === 0
      ) {
        toast({
          title: 'No changes',
          description:
            'Those emails were already authorized or invited for this deployment.',
        });
      }

      if (
        added === 0 &&
        invited === 0 &&
        alreadyShared === 0 &&
        alreadyInvited === 0 &&
        issues > 0
      ) {
        toast({
          title: 'No users were added',
          description:
            'None of the provided emails could be processed. See details below.',
          variant: 'destructive',
        });
      }
    } catch (mutationError) {
      const message =
        mutationError instanceof Error
          ? mutationError.message
          : 'Failed to share deployment.';
      setError(message);
      toast({
        title: 'Share failed',
        description: message,
        variant: 'destructive',
      });
    }
  }

  const defaultTrigger = (
    <Button
      type="button"
      variant="outline"
      className="w-full bg-white/50 dark:bg-white/5 border-0"
      onClick={(event) => event.stopPropagation()}
      disabled={disabled || !deploymentId}
    >
      <Share2 className="mr-2 size-4" />
      Share
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? defaultTrigger}</DialogTrigger>
      <DialogContent
        className="sm:max-w-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>Share deployment access</DialogTitle>
          <DialogDescription>
            Authorize other users to access{' '}
            <span className="font-medium text-foreground">{modelName}</span>.
            If an email is not registered yet, the invitation is saved and
            access is granted automatically once they sign up with that email.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <label
              htmlFor="share-deployment-emails"
              className="text-sm font-medium"
            >
              Email addresses
            </label>
            <div className="rounded-md border bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {emails.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                  >
                    {email}
                    <button
                      type="button"
                      onClick={() => removeEmail(email)}
                      className="rounded-full text-primary/80 hover:text-primary"
                      aria-label={`Remove ${email}`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                <Input
                  id="share-deployment-emails"
                  type="text"
                  inputMode="email"
                  autoComplete="off"
                  spellCheck={false}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={handleAddCurrentDraft}
                  placeholder={
                    emails.length === 0
                      ? 'name@example.com, another@example.com'
                      : 'Add another email'
                  }
                  className="flex-1 min-w-[12rem] border-0 px-1 py-0.5 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Press Enter, comma, or space to add an email.
            </p>
          </div>

          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : null}

          {results && results.length > 0 ? (
            <div className="rounded-md border bg-muted/40 p-3">
              <p className="mb-2 text-sm font-medium">Results</p>
              <ul className="space-y-1 text-sm">
                {results.map((result) => (
                  <li
                    key={`${result.email}-${result.status}`}
                    className="flex items-start justify-between gap-3"
                  >
                    <span className="break-all">{result.email}</span>
                    <span
                      className={cn(
                        'shrink-0 text-xs font-medium',
                        STATUS_TONE[result.status],
                      )}
                    >
                      {STATUS_LABEL[result.status]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Close
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Sharing...
              </>
            ) : (
              <>
                <Share2 className="mr-2 size-4" />
                Share access
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
