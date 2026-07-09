/**
 * Pure window-overlap math for SLO downtime accounting.
 *
 * A downtime event contributes to an SLO window only for the portion of its
 * duration that falls inside `[windowStart, windowEnd]`. Open (ongoing) events
 * have no `endTime` and run until `now`. This is deliberately separate from any
 * stored `durationSeconds` cache, which is not window-aware: a long outage that
 * began before the window (the dashboard "100% available + degraded" bug) must
 * still consume its in-window portion, and an event that straddles a window edge
 * must be clamped, not counted in full.
 */

export interface WindowedEventInput {
  startTime: Date;
  endTime: Date | null;
  attributionType: string;
  upstreamSystemId: string | null;
  upstreamSystemName: string | null;
}

/**
 * A planned maintenance window on the system. When the objective opts into
 * `excludeMaintenanceWindows`, the portion of any downtime event that overlaps
 * one of these intervals is subtracted from the consumed budget. Intervals are
 * closed-open `[startAt, endAt)`; a zero/negative-length window contributes
 * nothing.
 */
export interface MaintenanceWindowInput {
  startAt: Date;
  endAt: Date;
}

/** A half-open time interval in epoch milliseconds. */
interface MsInterval {
  start: number;
  end: number;
}

/**
 * Merge overlapping/touching intervals into a minimal, sorted set. Input is not
 * mutated. Zero/negative-length intervals are dropped.
 */
function mergeIntervals(intervals: MsInterval[]): MsInterval[] {
  const valid = intervals
    .filter((i) => i.end > i.start)
    .toSorted((a, b) => a.start - b.start);
  const merged: MsInterval[] = [];
  for (const interval of valid) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ start: interval.start, end: interval.end });
    }
  }
  return merged;
}

/**
 * Milliseconds of `[start, end)` NOT covered by any of the `holes` intervals.
 * Holes may overlap each other and extend outside the base; they are clamped
 * and merged first. Returns 0 for an empty/inverted base.
 */
function intervalMsMinusHoles({
  start,
  end,
  holes,
}: {
  start: number;
  end: number;
  holes: MsInterval[];
}): number {
  if (end <= start) return 0;
  const merged = mergeIntervals(holes);
  let covered = 0;
  for (const hole of merged) {
    const overlapStart = Math.max(start, hole.start);
    const overlapEnd = Math.min(end, hole.end);
    if (overlapEnd > overlapStart) {
      covered += overlapEnd - overlapStart;
    }
  }
  return end - start - covered;
}

export interface WindowedDowntime {
  totalMinutes: number;
  selfMinutes: number;
  upstreamMinutes: number;
  entries: Array<{
    attributionType: string;
    upstreamSystemId: string | null;
    upstreamSystemName: string | null;
    totalMinutes: number;
  }>;
}

/**
 * Seconds of a single event that fall inside the window. Open events (no
 * `endTime`) run to `now`. Returns 0 when the event does not overlap the window.
 */
export function eventWindowSeconds({
  startTime,
  endTime,
  windowStart,
  windowEnd,
  now,
  maintenanceWindows,
}: {
  startTime: Date;
  endTime: Date | null;
  windowStart: Date;
  windowEnd: Date;
  now: Date;
  /**
   * Optional planned maintenance windows to subtract. When provided, only the
   * portion of the event's in-window duration that does NOT fall inside a
   * maintenance window is counted. Undefined/empty leaves the duration
   * unchanged (backwards compatible).
   */
  maintenanceWindows?: MaintenanceWindowInput[];
}): number {
  const end = endTime ?? now;
  const effectiveStart = Math.max(startTime.getTime(), windowStart.getTime());
  const effectiveEnd = Math.min(end.getTime(), windowEnd.getTime());
  if (effectiveEnd <= effectiveStart) return 0;

  if (!maintenanceWindows || maintenanceWindows.length === 0) {
    return (effectiveEnd - effectiveStart) / 1000;
  }

  const holes = maintenanceWindows.map((w) => ({
    start: w.startAt.getTime(),
    end: w.endAt.getTime(),
  }));
  return (
    intervalMsMinusHoles({
      start: effectiveStart,
      end: effectiveEnd,
      holes,
    }) / 1000
  );
}

/**
 * Aggregate the in-window downtime across many events, split by attribution and
 * grouped per source (self, or one bucket per upstream system).
 */
export function aggregateWindowedDowntime({
  events,
  windowStart,
  windowEnd,
  now,
  maintenanceWindows,
}: {
  events: WindowedEventInput[];
  windowStart: Date;
  windowEnd: Date;
  now: Date;
  /**
   * Optional planned maintenance windows. When provided, the portion of every
   * event that overlaps a maintenance window is excluded from all aggregates
   * (total, self, upstream, and per-source), uniformly across attributions.
   */
  maintenanceWindows?: MaintenanceWindowInput[];
}): WindowedDowntime {
  let totalSeconds = 0;
  let selfSeconds = 0;
  let upstreamSeconds = 0;
  const bySource = new Map<
    string,
    {
      attributionType: string;
      upstreamSystemId: string | null;
      upstreamSystemName: string | null;
      totalSeconds: number;
    }
  >();

  for (const event of events) {
    const duration = eventWindowSeconds({
      startTime: event.startTime,
      endTime: event.endTime,
      windowStart,
      windowEnd,
      now,
      maintenanceWindows,
    });
    if (duration <= 0) continue;

    totalSeconds += duration;
    if (event.attributionType === "self") {
      selfSeconds += duration;
    } else {
      upstreamSeconds += duration;
    }

    const key =
      event.attributionType === "self"
        ? "self"
        : `upstream:${event.upstreamSystemId}`;
    const existing = bySource.get(key);
    if (existing) {
      existing.totalSeconds += duration;
    } else {
      bySource.set(key, {
        attributionType: event.attributionType,
        upstreamSystemId: event.upstreamSystemId,
        upstreamSystemName: event.upstreamSystemName,
        totalSeconds: duration,
      });
    }
  }

  return {
    totalMinutes: totalSeconds / 60,
    selfMinutes: selfSeconds / 60,
    upstreamMinutes: upstreamSeconds / 60,
    entries: [...bySource.values()].map((e) => ({
      attributionType: e.attributionType,
      upstreamSystemId: e.upstreamSystemId,
      upstreamSystemName: e.upstreamSystemName,
      totalMinutes: e.totalSeconds / 60,
    })),
  };
}
