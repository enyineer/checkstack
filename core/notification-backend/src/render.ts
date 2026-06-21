import type { Importance } from "@checkstack/notification-common";

// `SUBJECT_STATUS_EMOJI` now lives in `@checkstack/notification-common`
// (single source, alongside the shared subject-render helpers). Re-exported
// here so this module's existing public surface stays stable.
export { SUBJECT_STATUS_EMOJI } from "@checkstack/notification-common";

/**
 * Emoji used to prefix a notification's title in a rendered message, keyed
 * by the notification's importance level. Plugins should use this map rather
 * than redefining their own.
 */
export const IMPORTANCE_EMOJI: Record<Importance, string> = {
  info: "ℹ️",
  warning: "⚠️",
  critical: "🚨",
};
