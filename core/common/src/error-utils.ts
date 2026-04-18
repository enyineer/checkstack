/**
 * Extracts a human-readable message from an unknown error value.
 *
 * Handles Error instances, plain strings, and arbitrary values.
 * Designed as a single source of truth — use this instead of
 * inline `error instanceof Error ? error.message : fallback` patterns.
 */
export function extractErrorMessage(
  error: unknown,
  fallback = "An error occurred",
): string {
  // eslint-disable-next-line no-restricted-syntax -- This IS the canonical implementation
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return fallback;
}
