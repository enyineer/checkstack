import type { IncidentStatus } from "@checkstack/incident-common";

/**
 * Pure, DOM-free helpers for the incident config page list and its bulk
 * (mass delete / mass resolve) actions. Kept here so the selection + gating
 * branches are testable without rendering the page.
 */

/** Minimal incident row shape the bulk-selection helpers need. */
export interface SelectableIncident {
  id: string;
  status: IncidentStatus;
}

/**
 * Can an incident in this status still be resolved? Only incidents that are not
 * already resolved are resolvable (mirrors the single-item "Resolve" gate).
 */
export function canResolveIncident({
  status,
}: {
  status: IncidentStatus;
}): boolean {
  return status !== "resolved";
}

/**
 * Ids of incidents the caller may act on in bulk: only those they can MANAGE
 * (`canAccess(id)` true). Mirrors the per-row action gate so the multi-select
 * never offers a row the backend would reject. Used for the select-all control
 * and per-row checkbox visibility.
 */
export function selectableIncidentIds({
  incidents,
  canAccess,
}: {
  incidents: SelectableIncident[];
  canAccess: (id: string) => boolean;
}): string[] {
  return incidents.filter((i) => canAccess(i.id)).map((i) => i.id);
}

/**
 * Of the currently-selected ids, those that can still be RESOLVED: selected,
 * still manageable, and not already resolved. Mass-resolve acts only on these,
 * so an already-resolved row in the selection is silently skipped.
 */
export function resolvableIncidentIds({
  selectedIds,
  incidents,
  canAccess,
}: {
  selectedIds: ReadonlySet<string>;
  incidents: SelectableIncident[];
  canAccess: (id: string) => boolean;
}): string[] {
  return incidents
    .filter(
      (i) =>
        selectedIds.has(i.id) &&
        canAccess(i.id) &&
        canResolveIncident({ status: i.status }),
    )
    .map((i) => i.id);
}

/**
 * Prune a selection to the ids still present AND still selectable after a data
 * refetch, so a stale id (deleted, or a grant revoked) can never be submitted.
 */
export function pruneSelection({
  selectedIds,
  selectableIds,
}: {
  selectedIds: ReadonlySet<string>;
  selectableIds: readonly string[];
}): string[] {
  const allowed = new Set(selectableIds);
  return [...selectedIds].filter((id) => allowed.has(id));
}

/**
 * Format a per-id bulk-action result array into a short partial-success
 * summary, e.g. "3 deleted, 1 skipped". Anything that is not `successStatus`
 * (notFound / forbidden / error) counts as skipped.
 */
export function summarizeBulkOutcome({
  results,
  successStatus,
  successLabel,
}: {
  results: ReadonlyArray<{ status: string }>;
  successStatus: string;
  successLabel: string;
}): string {
  const success = results.filter((r) => r.status === successStatus).length;
  const skipped = results.length - success;
  return skipped > 0
    ? `${success} ${successLabel}, ${skipped} skipped`
    : `${success} ${successLabel}`;
}
