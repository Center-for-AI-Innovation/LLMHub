export const GUEST_CHAT_COUNT_COOKIE = 'guest_chat_message_count';
export const GUEST_CHAT_MAX_MESSAGES = 5;

export function getCookieValue(
  cookieHeader: string | null,
  cookieName: string,
): string | null {
  if (!cookieHeader) return null;

  const cookieParts = cookieHeader.split(';').map((part) => part.trim());
  for (const part of cookieParts) {
    if (part.startsWith(`${cookieName}=`)) {
      return decodeURIComponent(part.slice(cookieName.length + 1));
    }
  }

  return null;
}

export function getGuestMessageCount(cookieHeader: string | null): number {
  const rawGuestCount = getCookieValue(cookieHeader, GUEST_CHAT_COUNT_COOKIE);
  const guestMessageCount = Number.parseInt(rawGuestCount ?? '0', 10);
  return Number.isNaN(guestMessageCount) ? 0 : guestMessageCount;
}
