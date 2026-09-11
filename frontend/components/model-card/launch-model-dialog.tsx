'use client';

import * as React from 'react';
import { Loader2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SKIP_SLURM_ACCOUNT_PICKER, useSlurmAccounts } from '@/hooks/use-models';

interface LaunchModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelName: string;
  isLaunching: boolean;
  onLaunch: (time: string, account?: string) => void;
}

const skipAccountPicker = SKIP_SLURM_ACCOUNT_PICKER;

/**
 * Dialog for collecting job duration and Slurm account before launching a model.
 * Formats hours + minutes into HH:MM:00 for the backend.
 */
export function LaunchModelDialog({
  open,
  onOpenChange,
  modelName,
  isLaunching,
  onLaunch,
}: LaunchModelDialogProps) {
  const [hours, setHours] = React.useState<string>('0');
  const [minutes, setMinutes] = React.useState<string>('30');
  const [accountOverride, setAccountOverride] = React.useState<string | null>(
    null,
  );

  const {
    data: slurmAccounts,
    isLoading: isLoadingAccounts,
    isError: isAccountsError,
    error: accountsError,
    refetch: refetchAccounts,
    isFetching: isFetchingAccounts,
  } = useSlurmAccounts();

  const selectedAccount =
    accountOverride ?? slurmAccounts?.defaultAccount ?? '';

  function handleHoursChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    if (val === '' || (/^\d+$/.test(val) && parseInt(val, 10) <= 23)) {
      setHours(val);
    }
  }

  function handleMinutesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    if (val === '' || (/^\d+$/.test(val) && parseInt(val, 10) <= 59)) {
      setMinutes(val);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (hours === '' || minutes === '') return;
    const h = parseInt(hours, 10);
    const m = parseInt(minutes, 10);
    if (h === 0 && m === 0) return;
    if (!skipAccountPicker && !selectedAccount) return;
    const formatted = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
    onLaunch(formatted, selectedAccount || undefined);
  }

  const h = parseInt(hours || '0', 10);
  const m = parseInt(minutes || '0', 10);
  const isZeroDuration = h === 0 && m === 0;

  const validationErrorMessage =
    hours === ''
      ? 'Hours cannot be empty.'
      : minutes === ''
        ? 'Minutes cannot be empty.'
        : isZeroDuration
          ? 'Duration must be at least 1 minute.'
          : !skipAccountPicker && isAccountsError
            ? accountsError instanceof Error
              ? accountsError.message
              : 'Could not load Slurm accounts.'
            : !skipAccountPicker &&
                !isLoadingAccounts &&
                (slurmAccounts?.accounts.length ?? 0) === 0
              ? 'No Slurm accounts are associated with your cluster user.'
              : !skipAccountPicker && !isLoadingAccounts && !selectedAccount
                ? 'Select a Slurm account.'
                : null;

  const isInvalid = validationErrorMessage !== null;

  const handleDialogOpenChange = (nextOpen: boolean) => {
    // Prevent closing the dialog while a launch is in progress
    if (isLaunching && !nextOpen) {
      return;
    }
    if (nextOpen) {
      setAccountOverride(null);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="size-5 text-primary" />
            Set Model Lifetime
          </DialogTitle>
          <DialogDescription>
            Specify how long you need{' '}
            <span className="font-medium text-foreground">{modelName}</span> to
            run
            {skipAccountPicker ? '.' : ', and which Slurm account to charge.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="flex items-end gap-3 py-4">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="launch-hours">Hours</Label>
              <Input
                id="launch-hours"
                type="number"
                min={0}
                max={23}
                value={hours}
                onChange={handleHoursChange}
                placeholder="0"
                className="text-center tabular-nums"
              />
            </div>
            <span className="mb-2.5 text-xl font-semibold text-muted-foreground">
              :
            </span>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="launch-minutes">Minutes</Label>
              <Input
                id="launch-minutes"
                type="number"
                min={0}
                max={59}
                value={minutes}
                onChange={handleMinutesChange}
                placeholder="30"
                className="text-center tabular-nums"
              />
            </div>
          </div>

          {skipAccountPicker ? null : (
            <div className="space-y-1.5 pb-4">
              <Label htmlFor="launch-account">Slurm account</Label>
              <Select
                value={selectedAccount || undefined}
                onValueChange={setAccountOverride}
                disabled={
                  isLaunching ||
                  isLoadingAccounts ||
                  isAccountsError ||
                  (slurmAccounts?.accounts.length ?? 0) === 0
                }
              >
                <SelectTrigger id="launch-account" className="w-full">
                  <SelectValue
                    placeholder={
                      isLoadingAccounts
                        ? 'Loading accounts…'
                        : 'Select an account'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {(slurmAccounts?.accounts ?? []).map((account) => (
                    <SelectItem key={account} value={account}>
                      {account}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Jobs are charged to this allocation.
              </p>
              {isAccountsError ? (
                <button
                  type="button"
                  className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                  onClick={() => {
                    void refetchAccounts();
                  }}
                  disabled={isFetchingAccounts}
                >
                  {isFetchingAccounts ? 'Retrying…' : 'Retry loading accounts'}
                </button>
              ) : null}
            </div>
          )}

          {validationErrorMessage && (
            <p className="mb-3 text-xs text-destructive">
              {validationErrorMessage}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLaunching}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                isInvalid || isLaunching || (!skipAccountPicker && isLoadingAccounts)
              }
            >
              {isLaunching ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Launching...
                </>
              ) : (
                'Launch'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
