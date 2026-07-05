/**
 * Pure, DOM-free helpers behind {@link DataTable}. Extracted so the sort
 * comparator and the global-search filter can be unit-tested directly with
 * `bun test` without rendering a table.
 */

/** A value a column can be sorted by. `null`/`undefined` sort last. */
export type SortValue = string | number | null | undefined;

/**
 * Narrow an arbitrary cell value (TanStack's `row.getValue` returns `unknown`)
 * to a {@link SortValue} without an `as` cast. Non string/number values are
 * stringified so sorting still has a stable order; nullish stays `undefined`.
 */
export function toSortValue(value: unknown): SortValue {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return value;
  if (typeof value === "string") return value;
  return String(value);
}

/**
 * Compare two {@link SortValue}s for ascending order.
 *
 * - Two numbers compare numerically.
 * - Otherwise both sides are compared as strings using a locale-aware,
 *   `numeric` collator (so `"item 2"` sorts before `"item 10"`) with
 *   case-insensitive (`base`) sensitivity.
 * - `null`/`undefined` always sort last, regardless of direction. (The
 *   table also sets `sortUndefined: "last"`, but keeping it here makes the
 *   comparator correct in isolation.)
 */
export function compareSortValues(a: SortValue, b: SortValue): number {
  const aNil = a === null || a === undefined;
  const bNil = b === null || b === undefined;
  if (aNil && bNil) return 0;
  if (aNil) return 1;
  if (bNil) return -1;
  if (typeof a === "number" && typeof b === "number") {
    return a === b ? 0 : a < b ? -1 : 1;
  }
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/**
 * Does a row match the global search `query` for any of its searchable
 * columns? Matching is case-insensitive substring. An empty/whitespace query
 * matches everything.
 */
export function rowMatchesSearch<TData>({
  row,
  searchAccessors,
  query,
}: {
  row: TData;
  searchAccessors: ReadonlyArray<(row: TData) => string>;
  query: string;
}): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return searchAccessors.some((accessor) =>
    accessor(row).toLowerCase().includes(q),
  );
}

/**
 * Filter `rows` down to those matching the global search `query`. Returns the
 * same array reference when there is nothing to filter (empty query or no
 * searchable columns) so referential equality is preserved for memoisation.
 */
export function filterRows<TData>({
  rows,
  searchAccessors,
  query,
}: {
  rows: TData[];
  searchAccessors: ReadonlyArray<(row: TData) => string>;
  query: string;
}): TData[] {
  if (!query.trim() || searchAccessors.length === 0) return rows;
  return rows.filter((row) =>
    rowMatchesSearch({ row, searchAccessors, query }),
  );
}
