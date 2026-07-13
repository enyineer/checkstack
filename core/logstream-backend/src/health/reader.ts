/**
 * Read side of the log-stream health collectors. Every method is a single
 * cheap, indexed read over the pre-aggregated buckets / pattern rows - the
 * evaluation tick NEVER touches raw `log_events` and never does per-line work.
 *
 * Reads run against the plugin's scoped db as their own statements; the health
 * evaluation cadence is low (per assignment interval), so a shared read
 * transaction buys nothing. Query FAILURES propagate as thrown errors so the
 * collector maps them to a transport error (per the collector rule); an empty
 * result is a metric (zero), never an error.
 */

import type { SafeDatabase } from "@checkstack/backend-api";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type {
  StreamSeverityTotals,
  PatternVariableWindow,
} from "@checkstack/logstream-common";
import * as schema from "../schema";
import { logStreams, logPatterns, logPatternBuckets } from "../schema";
import type { Storage } from "../storage";

/** Minimal stream identity a reader is bound to (loaded once at connect). */
export interface StreamHandle {
  streamId: string;
  streamCreatedAt: Date;
}

/**
 * Windowed reads used by the window-metrics and pattern-occurrence collectors.
 * Bound to a single stream. All windows are half-open `[from, to)` over minute
 * buckets.
 */
export interface LogStreamHealthReader {
  readonly streamId: string;
  readonly streamCreatedAt: Date;
  /** Per-band line counts over the window (zero-filled). */
  readSeverityTotals(args: { from: Date; to: Date }): Promise<StreamSeverityTotals>;
  /** Distinct templates whose `firstSeenAt` falls inside the window. */
  readNewPatternCount(args: { from: Date; to: Date }): Promise<number>;
  /** Distinct templates with any bucket occurrence inside the window. */
  readDistinctPatternCount(args: { from: Date; to: Date }): Promise<number>;
  /** When the stream last received ANY line, or null if never. */
  readLastReceivedAt(): Promise<Date | null>;
  /** Total occurrences of one pattern over the window. */
  readPatternOccurrence(args: {
    patternId: string;
    from: Date;
    to: Date;
  }): Promise<number>;
  /** When one pattern was last seen, or null if the stream has no such pattern. */
  readPatternLastSeenAt(args: { patternId: string }): Promise<Date | null>;
  /**
   * Windowed numeric aggregate of one pattern's `<*>` value at `varIndex`.
   * `min`/`max` are null when the window has no numeric samples (the collector
   * maps that to zeroed fields, see {@link buildPatternMetric}).
   */
  readPatternVariableWindow(args: {
    patternId: string;
    varIndex: number;
    from: Date;
    to: Date;
  }): Promise<PatternVariableWindow>;
}

/**
 * Load a stream's identity, or `null` when the stream row no longer exists.
 * The strategy uses `null` as the "connection failure" signal (a config error:
 * the referenced stream was deleted).
 */
export async function loadStreamHandle({
  db,
  streamId,
}: {
  db: SafeDatabase<typeof schema>;
  streamId: string;
}): Promise<StreamHandle | null> {
  const [row] = await db
    .select({ id: logStreams.id, createdAt: logStreams.createdAt })
    .from(logStreams)
    .where(eq(logStreams.id, streamId))
    .limit(1);
  if (!row) return null;
  return { streamId: row.id, streamCreatedAt: row.createdAt };
}

/** Build the DB-backed reader for one stream. */
export function createDbReader({
  db,
  storage,
  handle,
}: {
  db: SafeDatabase<typeof schema>;
  storage: Storage;
  handle: StreamHandle;
}): LogStreamHealthReader {
  const { streamId, streamCreatedAt } = handle;

  return {
    streamId,
    streamCreatedAt,

    async readSeverityTotals({ from, to }) {
      return storage.sumSeverityBands({
        runner: db,
        streamId,
        from,
        to,
        grain: "minute",
      });
    },

    async readNewPatternCount({ from, to }) {
      const [row] = await db
        .select({ value: sql<string>`count(*)` })
        .from(logPatterns)
        .where(
          and(
            eq(logPatterns.streamId, streamId),
            gte(logPatterns.firstSeenAt, from),
            lt(logPatterns.firstSeenAt, to),
          ),
        );
      return Number(row?.value ?? 0);
    },

    async readDistinctPatternCount({ from, to }) {
      const [row] = await db
        .select({
          value: sql<string>`count(distinct ${logPatternBuckets.patternId})`,
        })
        .from(logPatternBuckets)
        .where(
          and(
            eq(logPatternBuckets.streamId, streamId),
            gte(logPatternBuckets.bucketStart, from),
            lt(logPatternBuckets.bucketStart, to),
          ),
        );
      return Number(row?.value ?? 0);
    },

    async readLastReceivedAt() {
      const activity = await storage.readStreamActivity({
        runner: db,
        streamId,
      });
      return activity?.lastReceivedAt ?? null;
    },

    async readPatternOccurrence({ patternId, from, to }) {
      const [row] = await db
        .select({ value: sql<string>`coalesce(sum(${logPatternBuckets.count}), 0)` })
        .from(logPatternBuckets)
        .where(
          and(
            eq(logPatternBuckets.streamId, streamId),
            eq(logPatternBuckets.patternId, patternId),
            gte(logPatternBuckets.bucketStart, from),
            lt(logPatternBuckets.bucketStart, to),
          ),
        );
      return Number(row?.value ?? 0);
    },

    async readPatternLastSeenAt({ patternId }) {
      const [row] = await db
        .select({ lastSeenAt: logPatterns.lastSeenAt })
        .from(logPatterns)
        .where(
          and(
            eq(logPatterns.id, patternId),
            eq(logPatterns.streamId, streamId),
          ),
        )
        .limit(1);
      return row?.lastSeenAt ?? null;
    },

    async readPatternVariableWindow({ patternId, varIndex, from, to }) {
      // Health windows are short (complete minutes + the in-progress minute),
      // always inside the minute-tier retention, so a single minute-grain read
      // mirrors how `readSeverityTotals` reads its window. A read REJECTION
      // propagates as a transport failure; an empty window is a metric (0s).
      return storage.readPatternVariableWindow({
        runner: db,
        streamId,
        patternId,
        varIndex,
        from,
        to,
        grain: "minute",
      });
    },
  };
}
