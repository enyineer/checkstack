/**
 * Read side of the `metric-window` collector. Every method is a cheap, indexed
 * read over the pre-aggregated buckets / registry rows - the evaluation tick
 * NEVER scans raw datapoints. Query FAILURES propagate as thrown errors so the
 * collector maps them to a transport error (per the collector rule); an empty
 * result is a metric (zero), never an error.
 */

import type { SafeDatabase } from "@checkstack/backend-api";
import { and, eq, sql } from "drizzle-orm";
import {
  MetricStreamConfigSchema,
  type CounterKind,
  type LabelFilter,
  type MetricType,
} from "@checkstack/metricstream-common";
import * as schema from "../schema";
import { metricStreams, metricSeries, metricNames } from "../schema";
import type { Storage } from "../storage";
import type {
  SeriesWindowAggregate,
  SeriesCumulativePoint,
  TierRange,
} from "../storage";
import {
  rollupBoundary,
  partitionWindowAtBoundary,
  combineWindowAggregates,
  countDistinctSeriesWithData,
} from "../storage";

/**
 * Upper bound on the concrete series one collector selection resolves. A
 * `(metricName, labelFilters)` selection that fans out past this is pathological
 * (an unfiltered high-cardinality metric); we cap the id set so a single
 * evaluation can never load an unbounded working set. The storage aggregate
 * helpers chunk the id list internally.
 */
export const MAX_SELECTED_SERIES = 20_000;

/** Minimal stream identity a reader is bound to (loaded once at connect). */
export interface StreamHandle {
  streamId: string;
  streamCreatedAt: Date;
  /**
   * The stream's `minuteRetentionHours` policy - the age past which minute
   * buckets are rolled up to hourly. Drives the reader's tier stitching so a
   * window wider than this reads the hourly tier for its older part instead of
   * silently under-reporting.
   */
  minuteRetentionHours: number;
}

/** The concrete series a `(metricName, labelFilters)` selection resolves to. */
export interface MetricSelection {
  seriesIds: string[];
  /** The metric's type from the name registry (drives counter rate math). */
  metricType: MetricType | null;
  /** The metric's counter flavor from the name registry (cumulative/delta). */
  counterKind: CounterKind | null;
  /**
   * The most recent `lastSeenAt` across the selected series, or null when the
   * selection matched no series. Drives `secondsSinceLastSample` (the collector
   * falls back to stream age when null).
   */
  lastSampleAt: Date | null;
}

/** Windowed reads used by the metric-window collector, bound to one stream. */
export interface MetricStreamHealthReader {
  readonly streamId: string;
  readonly streamCreatedAt: Date;
  /** Resolve the series (and metric metadata) a collector selection matches. */
  resolveSelection(args: {
    metricName: string;
    labelFilters: LabelFilter[];
  }): Promise<MetricSelection>;
  /**
   * Windowed aggregate over a set of series (zero-filled). Reads the minute tier
   * for the part of the window within `minuteRetentionHours` and the hourly tier
   * for the older part, folding both - so a window wider than minute retention is
   * fully covered, not silently truncated.
   */
  readWindowAggregate(args: {
    seriesIds: string[];
    from: Date;
    to: Date;
  }): Promise<SeriesWindowAggregate>;
  /**
   * Per-(series, bucket) cumulative `last` values for read-time counter rate,
   * stitched across tiers (hourly for the coarse part, minute for the fine part)
   * so successive-diff rate math stays contiguous across the rollup boundary.
   */
  readCumulativePoints(args: {
    seriesIds: string[];
    from: Date;
    to: Date;
  }): Promise<SeriesCumulativePoint[]>;
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
    .select({
      id: metricStreams.id,
      createdAt: metricStreams.createdAt,
      config: metricStreams.config,
    })
    .from(metricStreams)
    .where(eq(metricStreams.id, streamId))
    .limit(1);
  if (!row) return null;
  const config = MetricStreamConfigSchema.parse(row.config ?? {});
  return {
    streamId: row.id,
    streamCreatedAt: row.createdAt,
    minuteRetentionHours: config.minuteRetentionHours,
  };
}

/**
 * Build the JSONB-containment object for a set of exact-match label filters.
 * A series matches when it carries EVERY `key=value` pair (extra labels are
 * ignored - Postgres `@>` is subset containment). Duplicate keys collapse to
 * the last value (an impossible dual-value filter then matches nothing, which
 * is the correct exact-match semantics).
 */
export function labelFilterContainment(
  labelFilters: LabelFilter[],
): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const { key, value } of labelFilters) obj[key] = value;
  return obj;
}

/** A zero-filled window aggregate (a window that matched no buckets). */
const EMPTY_WINDOW_AGGREGATE: SeriesWindowAggregate = {
  sampleCount: 0,
  sum: 0,
  min: null,
  max: null,
  last: null,
  lastTs: null,
  deltaSum: 0,
  seriesCount: 0,
};

/** Build the DB-backed reader for one stream. */
export function createDbReader({
  db,
  storage,
  handle,
  now = () => new Date(),
}: {
  db: SafeDatabase<typeof schema>;
  storage: Storage;
  handle: StreamHandle;
  /** Injectable clock so the tier boundary is deterministic in tests. */
  now?: () => Date;
}): MetricStreamHealthReader {
  const { streamId, streamCreatedAt, minuteRetentionHours } = handle;

  return {
    streamId,
    streamCreatedAt,

    async resolveSelection({ metricName, labelFilters }) {
      // Metric metadata (type + counter flavor) from the name registry - a
      // single indexed PK lookup, never a series scan.
      const [nameRow] = await db
        .select({
          type: metricNames.type,
          counterKind: metricNames.counterKind,
        })
        .from(metricNames)
        .where(
          and(
            eq(metricNames.streamId, streamId),
            eq(metricNames.name, metricName),
          ),
        )
        .limit(1);

      const conditions = [
        eq(metricSeries.streamId, streamId),
        eq(metricSeries.name, metricName),
      ];
      if (labelFilters.length > 0) {
        const containment = labelFilterContainment(labelFilters);
        conditions.push(
          sql`${metricSeries.labels} @> ${JSON.stringify(containment)}::jsonb`,
        );
      }
      const rows = await db
        .select({ id: metricSeries.id, lastSeenAt: metricSeries.lastSeenAt })
        .from(metricSeries)
        .where(and(...conditions))
        .limit(MAX_SELECTED_SERIES);

      let lastSampleAt: Date | null = null;
      for (const row of rows) {
        if (lastSampleAt === null || row.lastSeenAt > lastSampleAt) {
          lastSampleAt = row.lastSeenAt;
        }
      }

      return {
        seriesIds: rows.map((r) => r.id),
        metricType: nameRow?.type ?? null,
        counterKind: nameRow?.counterKind ?? null,
        lastSampleAt,
      };
    },

    async readWindowAggregate({ seriesIds, from, to }) {
      // TIER STITCHING: the window's part younger than the rollup boundary is
      // still in the minute tier; the part older than it has been rolled up to
      // hourly. A window WIDER than `minuteRetentionHours` (e.g. a 24h window on
      // a stream that keeps only 6h of minutes) must read BOTH tiers, or every
      // field silently under-reports the older part. We split at the boundary and
      // read the minute tier for the fine part and the hourly tier for the coarse
      // part, then fold. A read REJECTION propagates as a transport failure.
      const boundary = rollupBoundary({ now: now(), minuteRetentionHours });
      const { coarse, fine } = partitionWindowAtBoundary({ from, to, boundary });

      const [coarseAgg, fineAgg] = await Promise.all([
        coarse
          ? storage.readWindowAggregate({
              runner: db,
              seriesIds,
              from: coarse.from,
              to: coarse.to,
              grain: "hour",
            })
          : null,
        fine
          ? storage.readWindowAggregate({
              runner: db,
              seriesIds,
              from: fine.from,
              to: fine.to,
              grain: "minute",
            })
          : null,
      ]);

      const parts: SeriesWindowAggregate[] = [];
      const ranges: TierRange[] = [];
      if (coarseAgg) {
        parts.push(coarseAgg);
        if (coarse) ranges.push({ grain: "hour", ...coarse });
      }
      if (fineAgg) {
        parts.push(fineAgg);
        if (fine) ranges.push({ grain: "minute", ...fine });
      }
      // One tier (the common case: window inside minute retention) needs no fold
      // and its `seriesCount` is already exact.
      if (parts.length <= 1) {
        return parts[0] ?? EMPTY_WINDOW_AGGREGATE;
      }
      // Both tiers contributed: fold, and recompute `seriesCount` as the DISTINCT
      // union across tiers (a continuously-reporting series is in both, so summing
      // the per-tier counts would double it).
      const seriesCount = await countDistinctSeriesWithData({
        runner: db,
        seriesIds,
        ranges,
      });
      return combineWindowAggregates({ parts, seriesCount });
    },

    async readCumulativePoints({ seriesIds, from, to }) {
      // Cross-tier as above: read the coarse part from the hourly tier and the
      // fine part from the minute tier. Concatenate and re-sort by (series,
      // bucket) so each series' points are CONTIGUOUS and ordered - hourly points
      // (older) then minute points (newer) - which is exactly what the reset-aware
      // `sumCumulativeIncrease` differencing expects across the boundary.
      const boundary = rollupBoundary({ now: now(), minuteRetentionHours });
      const { coarse, fine } = partitionWindowAtBoundary({ from, to, boundary });

      const [coarsePoints, finePoints] = await Promise.all([
        coarse
          ? storage.readCumulativePoints({
              runner: db,
              seriesIds,
              from: coarse.from,
              to: coarse.to,
              grain: "hour",
            })
          : Promise.resolve([]),
        fine
          ? storage.readCumulativePoints({
              runner: db,
              seriesIds,
              from: fine.from,
              to: fine.to,
              grain: "minute",
            })
          : Promise.resolve([]),
      ]);

      if (coarsePoints.length === 0) return finePoints;
      if (finePoints.length === 0) return coarsePoints;
      return [...coarsePoints, ...finePoints].toSorted((a, b) => {
        if (a.seriesId !== b.seriesId) {
          return a.seriesId < b.seriesId ? -1 : 1;
        }
        return a.bucketStart.getTime() - b.bucketStart.getTime();
      });
    },
  };
}
