import type { MaintenanceStatus } from "@checkstack/maintenance-common";

/**
 * Pure, DOM-free helpers for the maintenance config page list.
 *
 * `summarizeSystemNames` renders the affected-systems cell, and `canComplete`
 * gates the "Mark complete" action. Both are kept here so their truncation and
 * status branches are testable without rendering the page.
 */

/** The minimal system shape the summary needs (id for lookup, name to show). */
export interface NamedSystem {
  id: string;
  name: string;
}

/**
 * Summarize affected system names for a maintenance row. Shows up to three
 * names (resolving each id against `systems`, falling back to the raw id when
 * unknown) and appends a `+N more` token when the list is longer. Returns a
 * comma-separated string.
 */
export function summarizeSystemNames({
  systemIds,
  systems,
}: {
  systemIds: string[];
  systems: NamedSystem[];
}): string {
  const names = systemIds
    .map((id) => systems.find((s) => s.id === id)?.name ?? id)
    .slice(0, 3);
  if (systemIds.length > 3) {
    names.push(`+${systemIds.length - 3} more`);
  }
  return names.join(", ");
}

/**
 * Can a maintenance in this status still be marked complete? Only windows that
 * are neither already completed nor cancelled are completable.
 */
export function canComplete({ status }: { status: MaintenanceStatus }): boolean {
  return status !== "completed" && status !== "cancelled";
}

/** Minimal maintenance row shape the bulk-selection helpers need. */
export interface SelectableMaintenance {
  id: string;
  status: MaintenanceStatus;
}

/**
 * Ids of maintenances the caller may act on in bulk: only those they can
 * MANAGE (`canAccess(id)` true). Mirrors the per-row action gate so the
 * multi-select never offers a row the backend would reject. Used for the
 * select-all control and per-row checkbox visibility.
 */
export function selectableMaintenanceIds({
  maintenances,
  canAccess,
}: {
  maintenances: SelectableMaintenance[];
  canAccess: (id: string) => boolean;
}): string[] {
  return maintenances.filter((m) => canAccess(m.id)).map((m) => m.id);
}

/**
 * Of the currently-selected ids, those that can still be COMPLETED (the
 * "resolve"-equivalent for a maintenance): selected, still manageable, and in a
 * completable status. Mass-complete acts only on these, so an already-completed
 * or cancelled row in the selection is silently skipped.
 */
export function completableMaintenanceIds({
  selectedIds,
  maintenances,
  canAccess,
}: {
  selectedIds: ReadonlySet<string>;
  maintenances: SelectableMaintenance[];
  canAccess: (id: string) => boolean;
}): string[] {
  return maintenances
    .filter(
      (m) =>
        selectedIds.has(m.id) &&
        canAccess(m.id) &&
        canComplete({ status: m.status }),
    )
    .map((m) => m.id);
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
