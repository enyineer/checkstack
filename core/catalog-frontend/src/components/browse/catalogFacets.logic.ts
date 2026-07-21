import type { Group } from "@checkstack/catalog-common";
import type { DataTableFacetControl } from "@checkstack/ui";
import {
  BROWSE_PARAM,
  HealthFilterSchema,
  UNGROUPED_ID,
  type HealthFilter,
} from "./browseState.logic";

/**
 * The catalog toolbar's facet controls, handed to the shared
 * `DataTableFilterBar` so browse and manage render the one filter bar every
 * other list surface uses.
 *
 * These are CONTROLS, not full `DataTableFacet`s: the catalog's matching cannot
 * be expressed as one `value(row)` accessor. A system belongs to several groups
 * and carries several metadata tags, its health comes from a status map keyed by
 * id rather than from the row, and the same three controls also narrow GROUPS —
 * a different row type. So the bar renders them and `filterEntities.logic`
 * applies them.
 */

/** Labels shown in the Health facet. */
export const HEALTH_LABELS: Record<HealthFilter, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  unhealthy: "Unhealthy",
  unknown: "Unknown",
};

/** Shown on the disabled Health control, so the gap explains itself. */
export const HEALTH_DISABLED_REASON =
  "Health filtering becomes available once a health source is installed";

/**
 * Build the group/health/tag controls for the current data.
 *
 * Group options are the live groups plus the synthetic "Ungrouped" bucket, so
 * "systems in no group" is selectable and shareable like any other section. The
 * tag control is omitted entirely when no system carries string metadata —
 * there is nothing to narrow by, and an empty dropdown is just noise. Health is
 * kept but DISABLED while no health source has reported, so the capability is
 * visible and a health selection on an incoming link survives.
 */
export function buildCatalogFacets({
  groups,
  tagOptions,
  healthEnabled,
}: {
  groups: Group[];
  tagOptions: string[];
  healthEnabled: boolean;
}): DataTableFacetControl[] {
  const facets: DataTableFacetControl[] = [
    {
      id: BROWSE_PARAM.group,
      label: "Group",
      anyLabel: "All groups",
      options: [
        ...groups.map((group) => ({ value: group.id, label: group.name })),
        { value: UNGROUPED_ID, label: "Ungrouped" },
      ],
      triggerClassName: "md:w-44",
    },
    {
      id: BROWSE_PARAM.health,
      label: "Health",
      anyLabel: "All health",
      options: HealthFilterSchema.options.map((value) => ({
        value,
        label: HEALTH_LABELS[value],
      })),
      disabled: !healthEnabled,
      disabledReason: HEALTH_DISABLED_REASON,
      triggerClassName: "md:w-40",
    },
  ];

  if (tagOptions.length > 0) {
    facets.push({
      id: BROWSE_PARAM.tag,
      label: "Tag",
      anyLabel: "All tags",
      options: tagOptions.map((tag) => ({ value: tag, label: tag })),
      triggerClassName: "md:w-44",
    });
  }

  return facets;
}
