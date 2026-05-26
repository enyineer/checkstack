import type {
  Importance,
  SubjectStatus,
} from "@checkstack/notification-common";

/**
 * Emoji used to prefix an affected subject in a rendered notification, keyed
 * by the subject's health status. Plugins that render notifications in
 * plain-text channels (Slack, Discord, Teams, Telegram, Webex, etc.) should
 * use this map instead of redefining their own so operators see a consistent
 * visual language across destinations.
 */
export const SUBJECT_STATUS_EMOJI: Record<SubjectStatus, string> = {
  healthy: "🟢",
  degraded: "🟡",
  unhealthy: "🔴",
  unknown: "⚪",
};

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
