import { sanitizeUpdateMessage } from "@checkstack/notification-common";

/**
 * Formats the maintenance window for a notification body.
 *
 * ## Why UTC
 *
 * The notification pipeline has no per-recipient timezone: one body is rendered
 * and delivered to every subscriber, who may be anywhere. Rendering the server's
 * local time would be silently wrong for most of them, and rendering a bare
 * local time with no zone would be worse - unfalsifiable. UTC with an explicit
 * `UTC` suffix is unambiguous for everyone, and the notification's "View
 * Maintenance" action leads to a page that localises properly for the reader.
 *
 * Do NOT swap this for a server-local time without also giving the pipeline a
 * per-recipient timezone; an unlabelled local time is the failure mode this
 * exists to avoid.
 */
export function formatMaintenanceWindow({
  startAt,
  endAt,
}: {
  startAt?: Date | string | null;
  endAt?: Date | string | null;
}): string | undefined {
  const start = toValidDate(startAt);
  const end = toValidDate(endAt);
  if (!start || !end) return undefined;

  return `${formatUtc(start)} - ${formatUtc(end)} UTC`;
}

/** `2026-07-28 19:30`, in UTC. Fixed-width so a list of windows aligns. */
function formatUtc(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/**
 * Coerce to a Date, rejecting an unparseable value.
 *
 * The wire form of a timestamp is a string, and a malformed one yields an
 * `Invalid Date` whose `toISOString()` THROWS - which would take down the whole
 * notification rather than just omitting a line.
 */
function toValidDate(value?: Date | string | null): Date | undefined {
  if (value === undefined || value === null) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Build the maintenance notification body.
 *
 * The body used to be a single sentence naming only the title and what
 * happened, which told a subscriber nothing about WHAT was planned or WHEN - so
 * every recipient had to open the app to learn anything at all. It now carries
 * the scheduled window and the author's description, both of which the operator
 * already wrote.
 *
 * The description is user-supplied markdown and is normalised through the same
 * `sanitizeUpdateMessage` path as an update message: control characters
 * stripped, blank-line padding collapsed, length-bounded, authored markdown
 * preserved (see that module for why escaping here would be wrong).
 */
export function buildMaintenanceNotificationBody({
  maintenanceTitle,
  actionText,
  description,
  startAt,
  endAt,
  updateMessageSuffix,
}: {
  maintenanceTitle: string;
  actionText: string;
  description?: string | null;
  startAt?: Date | string | null;
  endAt?: Date | string | null;
  /** Pre-built suffix for the latest update message (may be empty). */
  updateMessageSuffix: string;
}): string {
  const lines = [
    `Maintenance **"${maintenanceTitle}"** has been ${actionText}.`,
  ];

  const window = formatMaintenanceWindow({ startAt, endAt });
  if (window) lines.push(`**When:** ${window}`);

  const sanitizedDescription = sanitizeUpdateMessage(description ?? undefined);
  if (sanitizedDescription) lines.push(sanitizedDescription);

  return `${lines.join("\n\n")}${updateMessageSuffix}`;
}
