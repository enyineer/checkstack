import { z } from "zod";
import type {
  HealthCheckConfiguration,
  HealthCheckStrategyDto,
} from "@checkstack/healthcheck-common";
import {
  applyTableFilters,
  parsedFacetValue,
  type DataTableFacet,
  type DataTableFacetControl,
  type DataTableFilterState,
} from "@checkstack/ui";

/**
 * Facet definitions for the health-check overview list, plus the matching that
 * `DataTable` cannot do for itself.
 *
 * The list mixes two kinds of filter, which is why the page renders the shared
 * `DataTableFilterBar` instead of handing everything to the table:
 *
 * - Search / strategy / status are CLIENT-side - a configuration carries the
 *   name, the strategy id and `paused`, so they are full {@link DataTableFacet}s.
 * - The system filter is SERVER-side: a configuration has no system field, and
 *   the assignment lives in a separate entity. Selecting a system swaps the
 *   whole data source over to `getSystemConfigurations`, which is authorized by
 *   system READ - that is what makes the catalog's per-system "Manage health
 *   checks" link work for someone who manages the SYSTEM but holds no
 *   health-check grants (their `getConfigurations` is empty). So it is a
 *   {@link DataTableFacetControl}: a control with no row accessor, because
 *   there is nothing on the row to accessor.
 */

/**
 * Facet ids. These double as the URL parameter names and deliberately keep the
 * names the hand-rolled toolbar used (`strategy` / `status` / `system`, plus
 * `DataTable`'s own `q`), so links shared before this migration - including the
 * catalog's per-system wayfinding link - still reopen the same view.
 */
export const HEALTHCHECK_FACET_ID = {
  strategy: "strategy",
  status: "status",
  system: "system",
} as const;

/** Every facet id, for `useDataTableFilters`. */
export const healthCheckFacetIds = [
  HEALTHCHECK_FACET_ID.strategy,
  HEALTHCHECK_FACET_ID.status,
  HEALTHCHECK_FACET_ID.system,
];

/**
 * Status values. The list shows Active vs Paused (derived from
 * `config.paused`); there is no run-level health status on this surface.
 */
export const HealthCheckStatusFilterSchema = z.enum(["active", "paused"]);
export type HealthCheckStatusFilter = z.infer<
  typeof HealthCheckStatusFilterSchema
>;

/** A system offered by the "assigned system" control. */
export interface HealthCheckSystemOption {
  id: string;
  name: string;
}

/** The search box matches the configuration name, and nothing else. */
export const healthCheckSearchAccessors = [
  (config: HealthCheckConfiguration) => config.name,
];

/** Placeholder + accessible name of the search box. */
export const HEALTHCHECK_SEARCH_PLACEHOLDER = "Search health checks";

/**
 * The client-applied facets: strategy (exact id) and active/paused. Strategy
 * options come from the strategy registry, so a newly installed strategy shows
 * up without a second list to maintain.
 */
export function healthCheckClientFacets({
  strategies,
}: {
  strategies: HealthCheckStrategyDto[];
}): DataTableFacet<HealthCheckConfiguration>[] {
  return [
    {
      id: HEALTHCHECK_FACET_ID.strategy,
      label: "Strategy",
      anyLabel: "All strategies",
      options: strategies.map((strategy) => ({
        value: strategy.id,
        label: strategy.displayName,
      })),
      value: (config) => config.strategyId,
      triggerClassName: "md:w-48",
    },
    {
      id: HEALTHCHECK_FACET_ID.status,
      label: "Status",
      anyLabel: "All statuses",
      options: [
        { value: "active", label: "Active" },
        { value: "paused", label: "Paused" },
      ],
      value: (config) => (config.paused ? "paused" : "active"),
      triggerClassName: "md:w-40",
    },
  ];
}

/**
 * The server-applied system control. No row accessor: the selection narrows the
 * QUERY, so the rows that arrive are already scoped to the system.
 */
export function healthCheckSystemControl({
  systems,
}: {
  systems: HealthCheckSystemOption[];
}): DataTableFacetControl {
  return {
    id: HEALTHCHECK_FACET_ID.system,
    label: "Assigned system",
    anyLabel: "All systems",
    options: systems.map((system) => ({
      value: system.id,
      label: system.name,
    })),
    triggerClassName: "md:w-52",
  };
}

/** Every control the filter bar renders, in display order. */
export function healthCheckFilterControls({
  strategies,
  systems,
}: {
  strategies: HealthCheckStrategyDto[];
  systems: HealthCheckSystemOption[];
}): DataTableFacetControl[] {
  return [
    ...healthCheckClientFacets({ strategies }),
    healthCheckSystemControl({ systems }),
  ];
}

/**
 * The selected system id, or `undefined` for "all systems". Parsed rather than
 * read straight off the state so a hand-edited link cannot smuggle an empty
 * string into the query input.
 */
export function selectedSystemId({
  filters,
}: {
  filters: DataTableFilterState;
}): string | undefined {
  return parsedFacetValue({
    filters,
    facetId: HEALTHCHECK_FACET_ID.system,
    schema: z.string().min(1),
  });
}

/**
 * Apply the search + the client-side facets. The system dimension is NOT
 * applied here - the caller has already scoped the rows by choosing the data
 * source, and re-applying it against a field the row does not have would drop
 * every row.
 *
 * Order is left to `DataTable`, which sorts by name by default.
 */
export function filterHealthChecks({
  configurations,
  filters,
  strategies,
}: {
  configurations: HealthCheckConfiguration[];
  filters: DataTableFilterState;
  strategies: HealthCheckStrategyDto[];
}): HealthCheckConfiguration[] {
  return applyTableFilters({
    rows: configurations,
    state: filters,
    facets: healthCheckClientFacets({ strategies }),
    searchAccessors: healthCheckSearchAccessors,
  });
}
