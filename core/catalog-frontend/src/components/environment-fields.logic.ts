/**
 * DOM-free helpers for the environment custom-fields editor.
 *
 * The editor renders free-form key/value rows. These helpers convert
 * between the stored `metadata` record and the editable row list, and
 * collapse the rows back into a record on save. Kept pure so they can be
 * unit-tested without a DOM (CI runs `bun test` from the repo root without
 * happy-dom).
 */

export interface CustomFieldRow {
  /** Stable client-side id so React keys survive reordering/removal. */
  rowId: string;
  key: string;
  value: string;
}

let rowCounter = 0;
function nextRowId(): string {
  rowCounter += 1;
  return `field-${rowCounter}`;
}

/**
 * Expand a stored `metadata` record into editable rows. Non-string values
 * are stringified so the free-form editor can round-trip them as text
 * (v1 custom fields are free-form, string-ish values).
 */
export function metadataToRows(
  metadata: Record<string, unknown> | null | undefined,
): CustomFieldRow[] {
  if (!metadata) return [];
  return Object.entries(metadata).map(([key, value]) => ({
    rowId: nextRowId(),
    key,
    value: stringifyValue(value),
  }));
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

/** Create a fresh empty row (for the "add field" action). */
export function emptyRow(): CustomFieldRow {
  return { rowId: nextRowId(), key: "", value: "" };
}

/**
 * Collapse editable rows back into a metadata record. Rows with a blank
 * (after-trim) key are dropped. On duplicate keys, the LAST row wins
 * (consistent with how a JS object literal resolves duplicate keys).
 * Keys are trimmed; values are kept verbatim.
 */
export function rowsToMetadata(
  rows: ReadonlyArray<CustomFieldRow>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key === "") continue;
    out[key] = row.value;
  }
  return out;
}

/**
 * Toggle an environment id in/out of a selected-id set. Returns a new
 * array (does not mutate). Used by the per-system environment picker.
 */
export function toggleSelectedId(props: {
  selected: ReadonlyArray<string>;
  id: string;
}): string[] {
  const { selected, id } = props;
  return selected.includes(id)
    ? selected.filter((existing) => existing !== id)
    : [...selected, id];
}

/** True when any row has a non-blank key that duplicates another row's key. */
export function hasDuplicateKeys(
  rows: ReadonlyArray<CustomFieldRow>,
): boolean {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.key.trim();
    if (key === "") continue;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}
