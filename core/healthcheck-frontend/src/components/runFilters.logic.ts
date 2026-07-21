import { z } from "zod";
import type { HealthCheckStatus } from "@checkstack/healthcheck-common";
import {
  parsedFacetValue,
  type DataTableFacetControl,
  type DataTableFilterState,
} from "@checkstack/ui";

/**
 * Status + source filters for the run-history surfaces (the history detail page
 * and the health-check drawer).
 *
 * Both are applied by the SERVER - the selection goes into `getHistory` /
 * `getDetailedHistory`, which page through the matching runs - so they are
 * {@link DataTableFacetControl}s with no row accessor: the rows that come back
 * are already narrowed, and a client-side re-application would only be able to
 * filter the page in hand.
 *
 * This module owns the mapping from a facet selection to the query input, which
 * is where the one piece of real logic lives (the coarse "failing" bucket).
 */

/** Facet ids, doubling as URL parameter names where the surface persists them. */
export const RUN_FACET_ID = {
  status: "status",
  source: "source",
} as const;

/** Both run-filter ids, for `useDataTableFilters`. */
export const runFacetIds = [RUN_FACET_ID.status, RUN_FACET_ID.source];

/**
 * Coarse status buckets. "Failing" collapses degraded and unhealthy because an
 * operator investigating a problem usually cares about "anything not green"
 * rather than the degraded/unhealthy distinction.
 */
export const RunStatusFilterSchema = z.enum(["healthy", "failing"]);
export type RunStatusFilter = z.infer<typeof RunStatusFilterSchema>;

const RUN_STATUS_BUCKETS: Record<RunStatusFilter, HealthCheckStatus[]> = {
  healthy: ["healthy"],
  failing: ["degraded", "unhealthy"],
};

/**
 * Two short outcomes an operator scans for, so they stay one click away rather
 * than behind a dropdown.
 */
export const runStatusControl: DataTableFacetControl = {
  id: RUN_FACET_ID.status,
  label: "Status",
  anyLabel: "All",
  kind: "pills",
  // Toned, because on a health surface green/red IS the vocabulary: a selected
  // "Failing" must not look the same as a selected "Healthy".
  options: [
    { value: "healthy", label: "Healthy", tone: "ok" },
    { value: "failing", label: "Failing", tone: "down" },
  ],
};

/** A satellite offered by the source control. */
export interface RunSourceSatellite {
  id: string;
  name: string;
}

/**
 * Where a run executed: the local core, or one of the registered satellites.
 * The option list is per-deployment, so the control is built rather than
 * declared.
 */
export function runSourceControl({
  satellites,
}: {
  satellites: RunSourceSatellite[];
}): DataTableFacetControl {
  return {
    id: RUN_FACET_ID.source,
    label: "Source",
    anyLabel: "All",
    kind: "pills",
    options: [
      { value: "local", label: "Local" },
      ...satellites.map((satellite) => ({
        value: satellite.id,
        label: satellite.name,
      })),
    ],
  };
}

/** The selected bucket, or `undefined` for "every status". */
export function selectedRunStatus({
  filters,
}: {
  filters: DataTableFilterState;
}): RunStatusFilter | undefined {
  return parsedFacetValue({
    filters,
    facetId: RUN_FACET_ID.status,
    schema: RunStatusFilterSchema,
  });
}

/**
 * The `statusFilter` query input for the current selection. `undefined` leaves
 * the query unconstrained, which is NOT the same as an empty array (that would
 * match no run at all).
 */
export function runStatusFilterInput({
  filters,
}: {
  filters: DataTableFilterState;
}): HealthCheckStatus[] | undefined {
  const selected = selectedRunStatus({ filters });
  return selected === undefined ? undefined : RUN_STATUS_BUCKETS[selected];
}

/**
 * The `sourceFilter` query input: `"local"` for the core, a satellite id, or
 * `undefined` for every source. Parsed, so a hand-edited link cannot smuggle an
 * empty string into the request.
 */
export function runSourceFilterInput({
  filters,
}: {
  filters: DataTableFilterState;
}): string | undefined {
  return parsedFacetValue({
    filters,
    facetId: RUN_FACET_ID.source,
    schema: z.string().min(1),
  });
}
