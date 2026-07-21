import { z } from "zod";
import {
  AnnouncementSeverityEnum,
  AnnouncementVisibilityEnum,
  type AnnouncementSeverity,
  type AnnouncementVisibility,
} from "@checkstack/announcement-common";
import {
  getAnnouncementStatus,
  AnnouncementStatusEnum,
  type AnnouncementLifecycle,
  type AnnouncementStatus,
} from "./announcementStatus.logic";

/**
 * Filtering for the announcement manage table. Pure and `now`-injectable so the
 * lifecycle-dependent filter (Status) is deterministic under test.
 */

/**
 * The "no constraint" choice for a facet. Deliberately NOT the string `"all"`:
 * `all` is a real `AnnouncementVisibility` value (meaning "everyone"), so using
 * it as the sentinel would make "show every visibility" indistinguishable from
 * "show only the public ones".
 */
export const ANY_FILTER = "any";
export type AnyFilter = typeof ANY_FILTER;

export interface AnnouncementFilters {
  /** Free-text match against the title (case-insensitive, trimmed). */
  query: string;
  severity: AnnouncementSeverity | AnyFilter;
  status: AnnouncementStatus | AnyFilter;
  visibility: AnnouncementVisibility | AnyFilter;
}

/** The unfiltered state - every facet unconstrained, empty search. */
export const NO_ANNOUNCEMENT_FILTERS: AnnouncementFilters = {
  query: "",
  severity: ANY_FILTER,
  status: ANY_FILTER,
  visibility: ANY_FILTER,
};

/**
 * The selectable values per facet, taken straight from the schemas that define
 * them, so a new severity/visibility/status shows up in the dropdown without a
 * second list to remember to update.
 */
export const ANNOUNCEMENT_SEVERITIES = AnnouncementSeverityEnum.options;
export const ANNOUNCEMENT_VISIBILITIES = AnnouncementVisibilityEnum.options;

const anyOr = <T extends z.ZodType>(schema: T) =>
  z.union([z.literal(ANY_FILTER), schema]);

const SeverityFilterSchema = anyOr(AnnouncementSeverityEnum);
const StatusFilterSchema = anyOr(AnnouncementStatusEnum);
const VisibilityFilterSchema = anyOr(AnnouncementVisibilityEnum);

/**
 * The `<Select>` primitives hand back a bare `string`, so each facet PARSES its
 * incoming value rather than asserting it. An unrecognised value degrades to
 * "unconstrained" - a filter state that shows everything - instead of silently
 * becoming a constraint that matches nothing.
 */
export function parseSeverityFilter(
  value: string,
): AnnouncementSeverity | AnyFilter {
  const parsed = SeverityFilterSchema.safeParse(value);
  return parsed.success ? parsed.data : ANY_FILTER;
}

export function parseStatusFilter(
  value: string,
): AnnouncementStatus | AnyFilter {
  const parsed = StatusFilterSchema.safeParse(value);
  return parsed.success ? parsed.data : ANY_FILTER;
}

export function parseVisibilityFilter(
  value: string,
): AnnouncementVisibility | AnyFilter {
  const parsed = VisibilityFilterSchema.safeParse(value);
  return parsed.success ? parsed.data : ANY_FILTER;
}

/**
 * The minimum shape the filters read. Structural (not the full `Announcement`)
 * so the tests can state exactly what a case depends on, and generic callers
 * keep their own row type.
 */
export interface FilterableAnnouncement extends AnnouncementLifecycle {
  title: string;
  severity: AnnouncementSeverity;
  visibility: AnnouncementVisibility;
}

/**
 * Whether any facet currently constrains the list. Drives the "Clear filters"
 * affordance and, because a hidden row makes "move up/down" ambiguous, the
 * disabling of the reorder controls.
 */
export function hasActiveAnnouncementFilters(
  filters: AnnouncementFilters,
): boolean {
  return (
    filters.query.trim().length > 0 ||
    filters.severity !== ANY_FILTER ||
    filters.status !== ANY_FILTER ||
    filters.visibility !== ANY_FILTER
  );
}

/**
 * Applies every active facet, preserving the caller's ordering (the table's
 * operator-defined order flows straight through). All facets are ANDed: each one
 * narrows the previous result.
 */
export function filterAnnouncements<T extends FilterableAnnouncement>({
  announcements,
  filters,
  now = new Date(),
}: {
  announcements: readonly T[];
  filters: AnnouncementFilters;
  now?: Date;
}): T[] {
  const query = filters.query.trim().toLowerCase();

  return announcements.filter((announcement) => {
    if (query && !announcement.title.toLowerCase().includes(query)) {
      return false;
    }
    if (
      filters.severity !== ANY_FILTER &&
      announcement.severity !== filters.severity
    ) {
      return false;
    }
    if (
      filters.visibility !== ANY_FILTER &&
      announcement.visibility !== filters.visibility
    ) {
      return false;
    }
    if (
      filters.status !== ANY_FILTER &&
      getAnnouncementStatus(announcement, now) !== filters.status
    ) {
      return false;
    }
    return true;
  });
}
