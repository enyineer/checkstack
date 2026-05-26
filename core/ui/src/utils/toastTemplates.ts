import { extractErrorMessage } from "@checkstack/common";
import type { useToast } from "../components/ToastProvider";

/**
 * Shape of the toast API exposed by {@link useToast}. Re-derived from
 * the hook's return type so the helpers stay in lock-step with any
 * future additions to the toast surface.
 */
export type ToastApi = ReturnType<typeof useToast>;

const MAX_TOAST_MESSAGE_LENGTH = 100;

/**
 * Truncate `message` to `MAX_TOAST_MESSAGE_LENGTH` characters, replacing
 * the tail with an ellipsis. Used to keep error toasts readable when
 * upstream payloads carry verbose stack traces.
 */
function truncate(message: string): string {
  if (message.length <= MAX_TOAST_MESSAGE_LENGTH) return message;
  return `${message.slice(0, MAX_TOAST_MESSAGE_LENGTH - 1)}…`;
}

/**
 * toastSuccess - shorthand for `toast.success(action)`.
 *
 * Use a verb-phrase for `action` so the toast reads naturally, e.g.
 * `"Check created"`, `"Configuration saved"`.
 */
export function toastSuccess(toast: ToastApi, action: string): void {
  toast.success(action);
}

/**
 * toastError - render an error toast in the canonical
 * `"{action}: {message}"` format, truncated to 100 characters.
 *
 * Funnels the unknown `error` through {@link extractErrorMessage} so
 * callers don't have to narrow at every call site.
 */
export function toastError(
  toast: ToastApi,
  action: string,
  error: unknown,
): void {
  const message = extractErrorMessage(error);
  toast.error(truncate(`${action}: ${message}`));
}
