/**
 * Pure helpers for surfacing a channel test-notification outcome. Kept out of
 * the component so the fallback logic (a failing test must always yield a
 * copyable message, even when the backend omits `error`) is unit-testable.
 */
import { extractErrorMessage } from "@checkstack/common";

/** Result contract returned by the `sendTestNotification` procedure. */
export interface ChannelTestResult {
  success: boolean;
  error?: string;
}

/**
 * Derive the inline error message to show for a channel test outcome, or `null`
 * when the test succeeded. A failed result with no `error` still yields a
 * message so the operator never sees a silent failure.
 */
export function deriveTestErrorMessage(result: ChannelTestResult): string | null {
  if (result.success) return null;
  return (
    result.error ??
    "The test notification failed, but the channel returned no error detail."
  );
}

/**
 * Derive the inline error message for a rejected test mutation - a transport or
 * auth failure that never produced the success/error contract above.
 */
export function deriveTestRejectionMessage(error: unknown): string {
  return extractErrorMessage(error, "Failed to send the test notification.");
}
