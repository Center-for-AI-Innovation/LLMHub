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

interface LaunchModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelName: string;
  isLaunching: boolean;
  onLaunch: (time: string) => void;
}

/**
 * Dialog for collecting job duration before launching a model.
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
    const formatted = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
    onLaunch(formatted);
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
          : null;

  const isInvalid = validationErrorMessage !== null;

  const handleDialogOpenChange = (nextOpen: boolean) => {
    // Prevent closing the dialog while a launch is in progress
    if (isLaunching && !nextOpen) {
      return;
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="size-5 text-primary" />
            Set Model Lifetime
          </DialogTitle>
          <DialogDescription>
            Specify how long you need <span className="font-medium text-foreground">{modelName}</span> to run.
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
            <span className="mb-2.5 text-xl font-semibold text-muted-foreground">:</span>
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

          {validationErrorMessage && (
            <p className="mb-3 text-xs text-destructive">{validationErrorMessage}</p>
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
            <Button type="submit" disabled={isInvalid || isLaunching}>
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
