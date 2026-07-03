/**
 * Pure prev/next selection logic for the run-history master-detail view (see
 * `runHistorySelection.logic.test.ts`).
 *
 * The list is ordered newest-first, so "next" walks DOWN the list to an older
 * run and "prev" walks UP to a newer one. At a page boundary the result asks
 * the caller to flip the page and select that page's first/last run once it
 * arrives; at an absolute boundary there is nothing to move to.
 */

/** Where an adjacent-run request lands. */
export type AdjacentRunResult =
  | { kind: "run"; runId: string }
  | { kind: "page"; page: number; select: "first" | "last" }
  | { kind: "none" };

/**
 * Resolve the run adjacent to `currentRunId` in `direction`. `runIds` is the
 * CURRENT page's run rows only (aggregate rows are never selectable), newest
 * first, matching the list order.
 */
export function getAdjacentRun({
  runIds,
  currentRunId,
  direction,
  page,
  totalPages,
}: {
  runIds: ReadonlyArray<string>;
  currentRunId: string;
  direction: "prev" | "next";
  page: number;
  totalPages: number;
}): AdjacentRunResult {
  const index = runIds.indexOf(currentRunId);
  if (index === -1) return { kind: "none" };

  if (direction === "prev") {
    if (index > 0) {
      return { kind: "run", runId: runIds[index - 1] };
    }
    // Top of this page: the newer run is the previous page's last row.
    if (page > 1) {
      return { kind: "page", page: page - 1, select: "last" };
    }
    return { kind: "none" };
  }

  if (index < runIds.length - 1) {
    return { kind: "run", runId: runIds[index + 1] };
  }
  // Bottom of this page: the older run is the next page's first row.
  if (page < totalPages) {
    return { kind: "page", page: page + 1, select: "first" };
  }
  return { kind: "none" };
}
