import { z } from "zod";
import type { NotificationPayload } from "@checkstack/backend-api";

/**
 * Version of the outgoing webhook JSON envelope. Bump ONLY on a breaking change
 * to the shape below; receivers switch on this field. The payload is a STABLE
 * PUBLIC CONTRACT - additive, optional fields are backwards-compatible and do
 * not require a bump.
 */
export const WEBHOOK_PAYLOAD_VERSION = 1 as const;

/**
 * One entity a notification is about (a system, a health check, ...), surfaced
 * to the receiver so it can link back. Mirrors the platform `NotificationSubject`.
 */
export const webhookSubjectSchema = z.object({
  kind: z.string(),
  id: z.string(),
  name: z.string(),
  url: z.string().optional(),
  status: z.enum(["healthy", "unhealthy", "degraded", "unknown"]).optional(),
});

/**
 * The JSON body POSTed to a subscriber's webhook URL. This is the plugin's
 * public contract - documented under
 * `docs/.../notifications/webhook-channel`. Keep it additive.
 */
export const webhookPayloadSchema = z.object({
  /** Envelope version; receivers switch on this. */
  version: z.literal(WEBHOOK_PAYLOAD_VERSION),
  /** ISO-8601 timestamp of when the notification was dispatched. */
  timestamp: z.string(),
  /** Source type identifier, e.g. "healthcheck.alert", "incident". */
  type: z.string(),
  /** Notification title/subject line. */
  title: z.string(),
  /** Markdown-formatted body (may be empty). */
  body: z.string(),
  /** Importance level for the receiver to triage on. */
  importance: z.enum(["info", "warning", "critical"]),
  /** Optional call-to-action deep link. */
  action: z
    .object({ label: z.string(), url: z.string() })
    .optional(),
  /** Affected entities (systems, checks, ...). */
  subjects: z.array(webhookSubjectSchema),
});

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

/**
 * Build the stable webhook JSON envelope from a platform notification payload.
 * Pure so it can be unit-tested. `now` is injectable for deterministic tests.
 */
export function buildWebhookPayload({
  notification,
  now = () => new Date(),
}: {
  notification: NotificationPayload;
  now?: () => Date;
}): WebhookPayload {
  return {
    version: WEBHOOK_PAYLOAD_VERSION,
    timestamp: now().toISOString(),
    type: notification.type,
    title: notification.title,
    body: notification.body ?? "",
    importance: notification.importance,
    ...(notification.action ? { action: notification.action } : {}),
    subjects: (notification.subjects ?? []).map((subject) => ({
      kind: subject.kind,
      id: subject.id,
      name: subject.name,
      ...(subject.url ? { url: subject.url } : {}),
      ...(subject.status ? { status: subject.status } : {}),
    })),
  };
}
