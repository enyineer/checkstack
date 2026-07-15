import type { SafeDatabase } from "@checkstack/backend-api";
import * as schema from "../schema";
import {
  countStreamSeries,
  selectExistingSeriesIds,
  insertNewSeries,
  touchSeriesLastSeen,
  deleteExpiredSeriesBatch,
} from "./series";
import {
  upsertMetricNames,
  decrementSeriesCount,
  listMetricNames,
} from "./names";
import {
  upsertMinuteBuckets,
  readWindowAggregate,
  readCumulativePoints,
  rollupMinuteToHourly,
  deleteExpiredMinuteBuckets,
  deleteExpiredHourlyBuckets,
  deleteBucketsForSeries,
} from "./buckets";
import { touchStreamActivity, readStreamActivity } from "./activity";
import { updateSeriesExemplars, readSeriesExemplars } from "./exemplars";

export * from "./time";
export * from "./series-id";
export * from "./cardinality";
export * from "./series";
export * from "./names";
export * from "./buckets";
export * from "./activity";
export * from "./exemplars";

/**
 * The storage seam shared by the ingest, health and API areas. Every helper
 * takes an explicit `runner` (the scoped db or a flush transaction), so the
 * ingest path composes them into ONE `withScopedTransaction`. `db` is exposed so
 * callers can open that transaction.
 */
export function createStorage({ db }: { db: SafeDatabase<typeof schema> }) {
  return {
    db,
    // series
    countStreamSeries,
    selectExistingSeriesIds,
    insertNewSeries,
    touchSeriesLastSeen,
    deleteExpiredSeriesBatch,
    // names
    upsertMetricNames,
    decrementSeriesCount,
    listMetricNames,
    // buckets
    upsertMinuteBuckets,
    readWindowAggregate,
    readCumulativePoints,
    rollupMinuteToHourly,
    deleteExpiredMinuteBuckets,
    deleteExpiredHourlyBuckets,
    deleteBucketsForSeries,
    // activity
    touchStreamActivity,
    readStreamActivity,
    // exemplars
    updateSeriesExemplars,
    readSeriesExemplars,
  };
}

export type Storage = ReturnType<typeof createStorage>;
