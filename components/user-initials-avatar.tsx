import { cn } from '@/lib/utils';

export function getUserInitials(
  name?: string | null,
  email?: string | null,
): string {
  const trimmedName = name?.trim();
  if (trimmedName) {
    const parts = trimmedName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const a = parts[0]?.[0];
      const b = parts[parts.length - 1]?.[0];
      if (a && b) return `${a}${b}`.toUpperCase();
    }
    const compact = trimmedName.replace(/\s/g, '');
    return compact.slice(0, 2).toUpperCase() || '?';
  }

  const trimmedEmail = email?.trim();
  if (trimmedEmail) {
    const local = trimmedEmail.split('@')[0] ?? '';
    const segments = local.split(/[._-]+/).filter(Boolean);
    if (segments.length >= 2) {
      const a = segments[0]?.[0];
      const b = segments[1]?.[0];
      if (a && b) return `${a}${b}`.toUpperCase();
    }
    return (local.slice(0, 2) || '?').toUpperCase();
  }

  return '?';
}

type UserInitialsAvatarProps = {
  name?: string | null;
  email?: string | null;
  className?: string;
};

export function UserInitialsAvatar({
  name,
  email,
  className,
}: UserInitialsAvatarProps) {
  const initials = getUserInitials(name, email);

  return (
    <span
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold leading-none text-primary-foreground',
        className,
      )}
      aria-hidden
    >
      {initials}
    </span>
  );
}
