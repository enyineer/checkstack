import type { AnnouncementSeverity } from "@checkstack/announcement-common";
import type { StatusPillTone } from "@checkstack/ui";

/**
 * The lifecycle status of an announcement, derived purely from its `active`
 * flag and its optional `startsAt` / `expiresAt` window relative to `now`.
 */
export type AnnouncementStatus =
  | "active"
  | "scheduled"
  | "expired"
  | "inactive";

/** The minimal lifecycle-relevant shape of an announcement. */
export interface AnnouncementLifecycle {
  active: boolean;
  startsAt?: Date | null;
  expiresAt?: Date | null;
}

/**
 * The colorblind-safe status tones used across the design system. Aliased from
 * the shared `@checkstack/ui` tone set so announcements can never drift out of
 * sync with it - notably the fifth blue `info` hue, which sits OUTSIDE the
 * ok/warn/down ladder.
 */
export type StatusTone = StatusPillTone;

/**
 * Classifies an announcement into its lifecycle status. Pure: takes `now` so it
 * is deterministic and unit-testable.
 */
export function getAnnouncementStatus(
  announcement: AnnouncementLifecycle,
  now: Date = new Date(),
): AnnouncementStatus {
  if (!announcement.active) return "inactive";

  if (announcement.startsAt && new Date(announcement.startsAt) > now) {
    return "scheduled";
  }

  if (announcement.expiresAt && new Date(announcement.expiresAt) <= now) {
    return "expired";
  }

  return "active";
}

/** Maps a lifecycle status onto its colorblind-safe triad tone. */
export function statusToTone(status: AnnouncementStatus): StatusTone {
  switch (status) {
    case "active": {
      return "ok";
    }
    default: {
      // scheduled / expired / inactive are all neutral "not currently live".
      return "unknown";
    }
  }
}

/** Maps an announcement severity onto its colorblind-safe status tone. */
export function severityToTone(severity: AnnouncementSeverity): StatusTone {
  switch (severity) {
    case "critical": {
      return "down";
    }
    case "warning": {
      return "warn";
    }
    default: {
      // Blue "info" tone, matching the incident/status-page severity ramp:
      // an informational announcement is deliberately published content, not an
      // inert/indeterminate state, so it must NOT fall through to the neutral
      // grey `unknown` tone (which read as "disabled" wherever it appeared).
      return "info";
    }
  }
}

/** The ordered status buckets shown in the manage-page stat summary. */
export const STATUS_BUCKETS: readonly {
  status: AnnouncementStatus;
  label: string;
}[] = [
  { status: "active", label: "Active" },
  { status: "scheduled", label: "Scheduled" },
  { status: "expired", label: "Expired" },
  { status: "inactive", label: "Inactive" },
] as const;

/**
 * Tallies a list of announcements into per-status counts. Pure and total: every
 * status key is present even when its count is zero.
 */
export function tallyStatuses(
  announcements: readonly AnnouncementLifecycle[],
  now: Date = new Date(),
): Record<AnnouncementStatus, number> {
  const counts: Record<AnnouncementStatus, number> = {
    active: 0,
    scheduled: 0,
    expired: 0,
    inactive: 0,
  };
  for (const announcement of announcements) {
    counts[getAnnouncementStatus(announcement, now)] += 1;
  }
  return counts;
}
