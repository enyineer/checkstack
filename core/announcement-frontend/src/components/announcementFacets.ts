import {
  AnnouncementSeverityEnum,
  AnnouncementVisibilityEnum,
  type Announcement,
} from "@checkstack/announcement-common";
import type { DataTableFacetOption } from "@checkstack/ui";
import { STATUS_BUCKETS } from "./announcementStatus.logic";

/**
 * Labels and option lists for the announcement table's filterable columns.
 *
 * The MATCHING lives on the columns themselves (`filterValue`), so each value is
 * read from a row in exactly one place - the same place that renders it and
 * sorts it. This module only supplies what cannot be derived: labels a person
 * should read instead of the raw enum value, and an order that carries meaning.
 */

/** Labels shown in the Severity facet and the severity pill. */
export const SEVERITY_LABELS: Record<Announcement["severity"], string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

/** Labels shown in the Visibility facet and the icon's tooltip. */
export const VISIBILITY_LABELS: Record<Announcement["visibility"], string> = {
  all: "Everyone",
  authenticated: "Authenticated only",
};

/** Labels shown in the Display column's icon tooltip (and its sort key). */
export const DISPLAY_MODE_LABELS: Record<Announcement["displayMode"], string> = {
  banner: "Banner",
  both: "Both",
  dashboard: "Dashboard",
};

/**
 * Severity options, ordered by IMPACT. Declared rather than derived on both
 * counts: the raw values are lowercase enum members, and deriving would sort
 * them alphabetically into critical / info / warning, which reads as noise
 * against a scale that runs info -> warning -> critical.
 */
export const SEVERITY_FILTER_OPTIONS: readonly DataTableFacetOption[] =
  AnnouncementSeverityEnum.options.map((value) => ({
    value,
    label: SEVERITY_LABELS[value],
  }));

/**
 * Lifecycle options in the same order the stat strip lists its buckets, so the
 * dropdown and the cards above the table agree.
 */
export const STATUS_FILTER_OPTIONS: readonly DataTableFacetOption[] =
  STATUS_BUCKETS.map(({ status, label }) => ({ value: status, label }));

/**
 * Visibility options. Declared for the labels: `all` would otherwise offer
 * itself as "all", which reads as "no filter" next to the unconstrained option.
 */
export const VISIBILITY_FILTER_OPTIONS: readonly DataTableFacetOption[] =
  AnnouncementVisibilityEnum.options.map((value) => ({
    value,
    label: VISIBILITY_LABELS[value],
  }));

/** The filterable column ids, for the URL-state hook. */
export const announcementFacetIds = ["severity", "status", "visibility"];
