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
