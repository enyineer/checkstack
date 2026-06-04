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
}: {
  startTime: Date;
  endTime: Date | null;
  windowStart: Date;
  windowEnd: Date;
  now: Date;
}): number {
  const end = endTime ?? now;
  const effectiveStart = Math.max(startTime.getTime(), windowStart.getTime());
  const effectiveEnd = Math.min(end.getTime(), windowEnd.getTime());
  const seconds = (effectiveEnd - effectiveStart) / 1000;
  return Math.max(0, seconds);
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
}: {
  events: WindowedEventInput[];
  windowStart: Date;
  windowEnd: Date;
  now: Date;
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
