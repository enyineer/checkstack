import {
  SEVERITY_BANDS,
  type EventCursor,
  type LogEvent,
  type SearchEvents,
  type SeverityBand,
} from "@checkstack/logstream-common";

/**
 * Explorer filter state and keyset-pagination helpers. Kept pure and
 * unit-tested: the filter -> query-input mapping and the "load older" cursor
 * merge are the parts most likely to regress, and they must not depend on React.
 */
export interface ExploreFilters {
  /** Free-text substring on the body (debounced before it reaches the query). */
  text: string;
  /** Selected severity bands; empty = all bands. */
  severityBands: SeverityBand[];
  /** Restrict to a single Drain pattern, or null for all. */
  patternId: string | null;
  from: Date | null;
  to: Date | null;
}

export const EMPTY_EXPLORE_FILTERS: ExploreFilters = {
  text: "",
  severityBands: [],
  patternId: null,
  from: null,
  to: null,
};

/** Toggle a band in the selection, preserving canonical band order. */
export function toggleBand(
  bands: SeverityBand[],
  band: SeverityBand,
): SeverityBand[] {
  const has = bands.includes(band);
  const next = has ? bands.filter((b) => b !== band) : [...bands, band];
  return SEVERITY_BANDS.filter((b) => next.includes(b));
}

/** True when any filter narrows the result set (drives a "clear" affordance). */
export function hasActiveFilters(filters: ExploreFilters): boolean {
  return (
    filters.text.trim().length > 0 ||
    filters.severityBands.length > 0 ||
    filters.patternId !== null ||
    filters.from !== null ||
    filters.to !== null
  );
}

export interface ToSearchInput {
  streamId: string;
  filters: ExploreFilters;
  cursor?: EventCursor;
  limit?: number;
}

/**
 * Build the `searchEvents` query input from the current filters. Omits empty
 * facets entirely so the backend applies no needless predicates, and only
 * forwards a trimmed non-empty text.
 */
export function toSearchInput({
  streamId,
  filters,
  cursor,
  limit,
}: ToSearchInput): SearchEvents {
  const text = filters.text.trim();
  return {
    streamId,
    ...(text.length > 0 ? { text } : {}),
    ...(filters.severityBands.length > 0
      ? { severityBands: filters.severityBands }
      : {}),
    ...(filters.patternId === null ? {} : { patternId: filters.patternId }),
    ...(filters.from === null ? {} : { from: filters.from }),
    ...(filters.to === null ? {} : { to: filters.to }),
    ...(cursor ? { cursor } : {}),
    limit: limit ?? 100,
  };
}

/** The keyset cursor pointing just past a given event `(ts, id)`. */
export function cursorFromEvent(event: LogEvent): EventCursor {
  return { ts: event.ts, id: event.id };
}

/**
 * Merge an older page onto the currently displayed events. `current` is the
 * newest-first list already shown; `incoming` is the next (older) page. The
 * result stays newest-first and de-duplicates by id, so a live refresh of the
 * newest page overlapping an accumulated older page never doubles a row.
 */
export function mergeOlderEvents({
  current,
  incoming,
}: {
  current: LogEvent[];
  incoming: LogEvent[];
}): LogEvent[] {
  const seen = new Set(current.map((e) => e.id));
  const merged = [...current];
  for (const event of incoming) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    merged.push(event);
  }
  return merged;
}
