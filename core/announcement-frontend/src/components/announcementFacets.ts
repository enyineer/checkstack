import {
  AnnouncementSeverityEnum,
  AnnouncementVisibilityEnum,
  type Announcement,
} from "@checkstack/announcement-common";
import type { DataTableFacet } from "@checkstack/ui";
import {
  STATUS_BUCKETS,
  getAnnouncementStatus,
} from "./announcementStatus.logic";

/**
 * The facet definitions for the announcement manage table, handed to
 * `DataTable` so it owns the filtering, the URL round-trip and the Clear
 * affordance. Pure data + accessors, so the option lists and the matching rules
 * are testable without rendering.
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
 * Narrow the table by severity, lifecycle status, or visibility.
 *
 * Option lists are derived from the schemas that define the values, so a new
 * severity or visibility appears in the dropdown without a second list to keep
 * in step. Status is the DERIVED lifecycle state rather than a stored column, so
 * the facet stays correct as an announcement's window opens and closes.
 */
export const announcementFacets: DataTableFacet<Announcement>[] = [
  {
    id: "severity",
    label: "Severity",
    options: AnnouncementSeverityEnum.options.map((value) => ({
      value,
      label: SEVERITY_LABELS[value],
    })),
    value: (announcement) => announcement.severity,
    triggerClassName: "md:w-36",
  },
  {
    id: "status",
    label: "Status",
    options: STATUS_BUCKETS.map(({ status, label }) => ({
      value: status,
      label,
    })),
    value: (announcement) => getAnnouncementStatus(announcement),
    triggerClassName: "md:w-36",
  },
  {
    id: "visibility",
    label: "Visibility",
    options: AnnouncementVisibilityEnum.options.map((value) => ({
      value,
      label: VISIBILITY_LABELS[value],
    })),
    value: (announcement) => announcement.visibility,
  },
];

/** The facet ids, for the URL-state hook. */
export const announcementFacetIds = announcementFacets.map(
  (facet) => facet.id,
);
