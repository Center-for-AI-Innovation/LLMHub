const GUEST_LIMIT_ERROR_PATTERN = /guest message limit reached|rate limit|429/i;
const MODEL_UNAVAILABLE_ERROR_PATTERN =
  /not found|404|unavailable model|model is not available/i;

function getRawErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return JSON.stringify(error);
}

export function extractErrorMessage(
  error: unknown,
  fallbackMessage: string,
): string {
  const rawMessage = getRawErrorMessage(error);
  if (!rawMessage) {
    return fallbackMessage;
  }

  try {
    const parsed = JSON.parse(rawMessage);
    if (parsed?.error?.message) return parsed.error.message;
    if (parsed?.message) return parsed.message;
  } catch {
    const jsonStart = rawMessage.indexOf('{');
    const jsonEnd = rawMessage.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      try {
        const parsed = JSON.parse(rawMessage.slice(jsonStart, jsonEnd + 1));
        if (parsed?.error?.message) return parsed.error.message;
        if (parsed?.message) return parsed.message;
      } catch {
        // Ignore parse errors and fall back to the raw message.
      }
    }
  }

  return rawMessage;
}

export function isGuestLimitErrorMessage(message: string): boolean {
  return GUEST_LIMIT_ERROR_PATTERN.test(message);
}

export function normalizeChatRequestError(error: unknown): string {
  const message = extractErrorMessage(
    error,
    'An error occurred, please try again.',
  );

  if (isGuestLimitErrorMessage(message)) {
    return 'Guest message limit reached. Please sign in to continue.';
  }

  if (MODEL_UNAVAILABLE_ERROR_PATTERN.test(message)) {
    return 'Selected model is unavailable. Please choose another model or refresh deployments.';
  }

  return message;
}
