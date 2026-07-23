'use client';

import {
  type ReactNode,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Loader2, X, Share2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

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
import {
  type ShareDeploymentResultEntry,
  SHARE_STATUS_LABEL as STATUS_LABEL,
  SHARE_STATUS_TONE as STATUS_TONE,
} from '@/lib/models/deployment-sharing';
import {
  useShareDeployment,
  useUserSearch,
  useDeploymentSharing,
  type UserSearchResult,
} from '@/hooks/use-models';
import { useOnClickOutside } from '@/hooks/use-on-click-outside';

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
  const queryClient = useQueryClient();
  const { mutateAsync: shareDeployment, isPending } = useShareDeployment();

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<UserSearchResult[]>([]);
  const [query, setQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ShareDeploymentResultEntry[] | null>(
    null,
  );

  const comboboxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const ignoreMouseHighlightRef = useRef(false);
  useOnClickOutside(comboboxRef as RefObject<HTMLElement>, () =>
    setShowSuggestions(false),
  );

  const { data: searchResults = [], isFetching: isSearching } =
    useUserSearch(query);
  const { data: sharing, isLoading: isLoadingAccess } = useDeploymentSharing(
    deploymentId,
    open,
  );

  useEffect(() => {
    if (!open) {
      // Reset transient state when the dialog closes.
      setSelected([]);
      setQuery('');
      setShowSuggestions(false);
      setHighlightedIndex(-1);
      setError(null);
      setResults(null);
    }
  }, [open]);

  // Emails that can't be added again: those already authorized/invited, plus
  // ones already picked in this session.
  const unavailableEmails = useMemo(() => {
    const set = new Set<string>();
    for (const u of sharing?.authorizedUsers ?? []) {
      set.add(u.email.toLowerCase());
    }
    for (const invite of sharing?.pendingInvites ?? []) {
      set.add(invite.email.toLowerCase());
    }
    for (const u of selected) {
      set.add(u.email.toLowerCase());
    }
    return set;
  }, [sharing, selected]);

  const suggestions = useMemo(
    () =>
      searchResults.filter(
        (user) => !unavailableEmails.has(user.email.toLowerCase()),
      ),
    [searchResults, unavailableEmails],
  );

  const showDropdown = showSuggestions && query.trim().length > 0;

  // Keep highlight in range when the suggestion list changes.
  useEffect(() => {
    if (!showDropdown || suggestions.length === 0) {
      setHighlightedIndex(-1);
      return;
    }
    setHighlightedIndex((current) =>
      current < 0 || current >= suggestions.length ? 0 : current,
    );
  }, [showDropdown, suggestions]);

  // Scroll the highlighted option into view inside the dropdown.
  useEffect(() => {
    if (highlightedIndex < 0 || !listRef.current) return;
    const option = listRef.current.children[highlightedIndex] as
      | HTMLElement
      | undefined;
    option?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  const hasSelection = selected.length > 0;
  const canSubmit = useMemo(
    () => Boolean(deploymentId) && hasSelection && !isPending && !disabled,
    [deploymentId, hasSelection, isPending, disabled],
  );

  function selectUser(user: UserSearchResult) {
    setSelected((current) =>
      current.some((u) => u.id === user.id) ? current : [...current, user],
    );
    setQuery('');
    setShowSuggestions(false);
    setHighlightedIndex(-1);
    setError(null);
  }

  function removeUser(id: string) {
    setSelected((current) => current.filter((u) => u.id !== id));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setShowSuggestions(false);
      setHighlightedIndex(-1);
      return;
    }

    if (!showDropdown || suggestions.length === 0) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        ignoreMouseHighlightRef.current = true;
        setHighlightedIndex((current) =>
          current < suggestions.length - 1 ? current + 1 : 0,
        );
        break;
      case 'ArrowUp':
        event.preventDefault();
        ignoreMouseHighlightRef.current = true;
        setHighlightedIndex((current) =>
          current > 0 ? current - 1 : suggestions.length - 1,
        );
        break;
      case 'Enter':
        if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
          event.preventDefault();
          selectUser(suggestions[highlightedIndex]);
        }
        break;
    }
  }

  function handleOptionPointerMove(index: number) {
    if (ignoreMouseHighlightRef.current) {
      ignoreMouseHighlightRef.current = false;
      return;
    }
    setHighlightedIndex((current) => (current === index ? current : index));
  }

  async function handleSubmit() {
    if (!deploymentId) {
      setError('No deployment selected.');
      return;
    }
    if (selected.length === 0) {
      setError('Select at least one user to share access with.');
      return;
    }

    setError(null);

    try {
      const response = await shareDeployment({
        deploymentId,
        emails: selected.map((u) => u.email),
      });
      setResults(response.results);
      // Refresh the "people with access" list without closing the dialog.
      queryClient.invalidateQueries({
        queryKey: ['deploymentSharing', deploymentId],
      });
      setSelected([]);

      const { added, alreadyShared, invited, alreadyInvited, invalid, failed } =
        response.summary;

      const grantedSummary: string[] = [];
      if (added > 0) {
        grantedSummary.push(`${added} user${added === 1 ? '' : 's'} added`);
      }
      if (invited > 0) {
        grantedSummary.push(
          `${invited} email${invited === 1 ? '' : 's'} invited (pending signup)`,
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
            'Those users already had access to this deployment.',
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
            'None of the selected users could be processed. See details below.',
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

  const authorizedUsers = sharing?.authorizedUsers ?? [];
  const pendingInvites = sharing?.pendingInvites ?? [];

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
            Search for registered users by name or email to grant them access
            to{' '}
            <span className="font-medium text-foreground">{modelName}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="share-user-search" className="text-sm font-medium">
              Add people
            </label>

            {selected.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {selected.map((user) => (
                  <span
                    key={user.id}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                  >
                    {user.name || user.email}
                    <button
                      type="button"
                      onClick={() => removeUser(user.id)}
                      className="rounded-full text-primary/80 hover:text-primary"
                      aria-label={`Remove ${user.name || user.email}`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <div ref={comboboxRef} className="relative">
              <Input
                id="share-user-search"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onKeyDown={handleKeyDown}
                placeholder="Search by name or email"
              />

              {showDropdown ? (
                <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
                  {isSearching ? (
                    <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      Searching...
                    </div>
                  ) : suggestions.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      No matching users found.
                    </div>
                  ) : (
                    <ul ref={listRef} className="max-h-56 overflow-y-auto py-1">
                      {suggestions.map((user, index) => (
                        <li key={user.id}>
                          <button
                            type="button"
                            onClick={() => selectUser(user)}
                            onMouseMove={() => handleOptionPointerMove(index)}
                            className={cn(
                              'flex w-full flex-col items-start px-3 py-1.5 text-left',
                              index === highlightedIndex &&
                                'bg-accent text-accent-foreground',
                            )}
                          >
                            <span className="text-sm font-medium">
                              {user.name}
                            </span>
                            <span
                              className={cn(
                                'text-xs',
                                index === highlightedIndex
                                  ? 'text-accent-foreground/80'
                                  : 'text-muted-foreground',
                              )}
                            >
                              {user.email}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="space-y-2">
            <p className="text-sm font-medium">People with access</p>
            {isLoadingAccess ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading...
              </div>
            ) : authorizedUsers.length === 0 && pendingInvites.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No one else has access yet.
              </p>
            ) : (
              <ul className="space-y-1">
                {authorizedUsers.map((user) => (
                  <li
                    key={user.userId}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="flex flex-col">
                      <span className="font-medium">{user.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {user.email}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {user.permission === 'owner' ? 'Owner' : 'Member'}
                    </span>
                  </li>
                ))}
                {pendingInvites.map((invite) => (
                  <li
                    key={invite.id}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="break-all">{invite.email}</span>
                    <span className="shrink-0 text-xs text-sky-600 dark:text-sky-400">
                      Pending signup
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

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
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
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
