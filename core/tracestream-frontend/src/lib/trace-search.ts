import type {
  SearchTraces,
  TraceSearchCursor,
  TraceStatusFilter,
  TraceSummary,
} from "@checkstack/tracestream-common";

/**
 * Trace-search filter state and keyset-pagination helpers. Kept pure and
 * unit-tested: the filter -> query-input mapping and the "load older" cursor
 * merge are the parts most likely to regress, and they must not depend on
 * React. Mirrors `logstream-frontend`'s `explore-filters.ts`.
 */
export interface TraceSearchFilters {
  serviceName: string | null;
  spanName: string | null;
  status: TraceStatusFilter | null;
  /** Free-text duration bounds (ms) as entered; empty = unset. */
  minDurationMs: number | null;
  maxDurationMs: number | null;
  /** Exact trace id lookup; when set, other facets are ignored server-side. */
  traceId: string | null;
  from: Date | null;
  to: Date | null;
}

export const EMPTY_TRACE_FILTERS: TraceSearchFilters = {
  serviceName: null,
  spanName: null,
  status: null,
  minDurationMs: null,
  maxDurationMs: null,
  traceId: null,
  from: null,
  to: null,
};

/** True when any facet narrows the result set (drives a "clear" affordance). */
export function hasActiveTraceFilters(filters: TraceSearchFilters): boolean {
  return (
    filters.serviceName !== null ||
    filters.spanName !== null ||
    filters.status !== null ||
    filters.minDurationMs !== null ||
    filters.maxDurationMs !== null ||
    (filters.traceId !== null && filters.traceId.trim().length > 0)
  );
}

/**
 * Fallback "last 24 hours" window used while the user has not picked a range.
 * The end is quantized UP to the next minute boundary so every call within the
 * same minute yields an identical window (stable query keys, no refetch flash).
 */
export function defaultTraceRange({ now = Date.now() }: { now?: number } = {}): {
  startDate: Date;
  endDate: Date;
} {
  const end = Math.ceil(now / 60_000) * 60_000;
  return {
    startDate: new Date(end - 24 * 60 * 60 * 1000),
    endDate: new Date(end),
  };
}

/** The user's explicit window, else the quantized 24h fallback. */
export function effectiveTraceRange({
  from,
  to,
  now = Date.now(),
}: {
  from: Date | null;
  to: Date | null;
  now?: number;
}): { startDate: Date; endDate: Date } {
  return from && to
    ? { startDate: from, endDate: to }
    : defaultTraceRange({ now });
}

export interface ToTraceSearchInput {
  streamId: string;
  filters: TraceSearchFilters;
  range: { startDate: Date; endDate: Date };
  cursor?: TraceSearchCursor;
  limit?: number;
}

/**
 * Build the `searchTraces` query input from the current filters + effective
 * window. Omits empty facets entirely so the backend applies no needless
 * predicates. A non-empty `traceId` still rides along; the backend treats it as
 * an exact lookup within the window.
 */
export function toTraceSearchInput({
  streamId,
  filters,
  range,
  cursor,
  limit,
}: ToTraceSearchInput): SearchTraces {
  const traceId = filters.traceId?.trim();
  return {
    streamId,
    from: range.startDate,
    to: range.endDate,
    ...(filters.serviceName ? { serviceName: filters.serviceName } : {}),
    ...(filters.spanName ? { spanName: filters.spanName } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.minDurationMs === null
      ? {}
      : { minDurationMs: filters.minDurationMs }),
    ...(filters.maxDurationMs === null
      ? {}
      : { maxDurationMs: filters.maxDurationMs }),
    ...(traceId && traceId.length > 0 ? { traceId } : {}),
    ...(cursor ? { cursor } : {}),
    limit: limit ?? 50,
  };
}

/**
 * Merge an older page of summaries onto the currently displayed list. `current`
 * is the newest-first list already shown; `incoming` is the next (older) page.
 * The result stays newest-first and de-duplicates by `traceId`, so a live
 * refresh of the newest page overlapping an accumulated older page never
 * doubles a row.
 */
export function mergeOlderTraces({
  current,
  incoming,
}: {
  current: TraceSummary[];
  incoming: TraceSummary[];
}): TraceSummary[] {
  const seen = new Set(current.map((t) => t.traceId));
  const merged = [...current];
  for (const trace of incoming) {
    if (seen.has(trace.traceId)) continue;
    seen.add(trace.traceId);
    merged.push(trace);
  }
  return merged;
}

/** Largest `durationMs` among the visible traces (for the relative bar scale). */
export function maxTraceDuration(traces: ReadonlyArray<TraceSummary>): number {
  let max = 0;
  for (const t of traces) if (t.durationMs > max) max = t.durationMs;
  return max;
}

/** Parse a duration input field into a non-negative number, or null when blank/invalid. */
export function parseDurationInput(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
