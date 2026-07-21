import { z } from "zod";
import type { AnnouncementSeverity } from "@checkstack/announcement-common";
import type { StatusPillTone } from "@checkstack/ui";

/**
 * The lifecycle status of an announcement, derived purely from its `active`
 * flag and its optional `startsAt` / `expiresAt` window relative to `now`.
 *
 * Schema-backed (not a bare union) so the manage page's Status filter can PARSE
 * a `<Select>`'s string value against the very same definition the type comes
 * from - one source, no hand-maintained second list to drift.
 */
export const AnnouncementStatusEnum = z.enum([
  "active",
  "scheduled",
  "expired",
  "inactive",
]);
export type AnnouncementStatus = z.infer<typeof AnnouncementStatusEnum>;

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

/**
 * Maps a lifecycle status onto its status tone, for the AGGREGATE view only -
 * the manage page's 4-up stat strip, where each card IS a lifecycle bucket.
 *
 * Individual announcements are NOT tinted by lifecycle: a row's colour is its
 * SEVERITY (see {@link severityToTone}) and its lifecycle is stated in words by
 * a neutral pill. Hue therefore answers "how loud is this announcement" in one
 * place and "which bucket is this" in the other, instead of the two competing.
 *
 * Every arm is spelled out: scheduled/expired/inactive previously fell through a
 * `default:` to the grey `unknown` tone, so "scheduled" was grey by omission
 * rather than by decision.
 */
export function statusToTone(status: AnnouncementStatus): StatusTone {
  switch (status) {
    case "active": {
      // Live right now.
      return "ok";
    }
    case "scheduled": {
      // Configured and waiting for its start date - informational, NOT a fault.
      // Deliberately not the amber `warn` tone, which means "degraded / needs
      // attention" everywhere else and would read as a problem.
      return "info";
    }
    case "expired": {
      // Its window has passed: inert, which is what the grey tone is for.
      return "unknown";
    }
    case "inactive": {
      // Deliberately switched off: also inert. Shares grey with `expired` - the
      // two are distinguished by their labels, never by colour alone.
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

/**
 * Impact rank for announcement severity: loudest first (lowest number), so an
 * ascending sort on the Severity column surfaces what shouts most rather than
 * what happens to come first alphabetically ("critical, info, warning").
 * Mirrors `incidentSeverityRank` in incident-frontend.
 */
export const announcementSeverityRank: Record<AnnouncementSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/**
 * Lifecycle rank for announcement status: live first, then not-yet-live, then
 * the two inert states - the same order the stat strip lists its buckets in, so
 * sorting the Status column and reading the cards agree. An alphabetical sort
 * would interleave them meaninglessly ("active, expired, inactive, scheduled").
 */
export const announcementStatusRank: Record<AnnouncementStatus, number> = {
  active: 0,
  scheduled: 1,
  expired: 2,
  inactive: 3,
};

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
