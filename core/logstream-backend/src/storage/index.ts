import type { SafeDatabase } from "@checkstack/backend-api";
import * as schema from "../schema";
import { insertLogEventsBatch } from "./events";
import {
  upsertSeverityBuckets,
  upsertPatternBuckets,
  upsertPatterns,
  readSeverityBuckets,
  readPatternBuckets,
  sumSeverityBands,
} from "./buckets";
import {
  touchStreamActivity,
  setSilenceMarker,
  readStreamActivity,
} from "./activity";
import {
  upsertVariableBuckets,
  readPatternVariableWindow,
  rollupVariableBuckets,
  deleteExpiredVariableHourly,
} from "./variable-buckets";

export * from "./time";
export * from "./events";
export * from "./buckets";
export * from "./activity";
export * from "./variable-buckets";

/**
 * The storage seam shared by the ingest, health and API areas. Every helper
 * takes an explicit `runner` (the scoped db or a flush transaction), so the
 * ingest path composes them into ONE `withScopedTransaction`. `db` is exposed
 * so callers can open that transaction.
 */
export function createStorage({ db }: { db: SafeDatabase<typeof schema> }) {
  return {
    db,
    insertLogEventsBatch,
    upsertSeverityBuckets,
    upsertPatternBuckets,
    upsertPatterns,
    readSeverityBuckets,
    readPatternBuckets,
    sumSeverityBands,
    touchStreamActivity,
    setSilenceMarker,
    readStreamActivity,
    upsertVariableBuckets,
    readPatternVariableWindow,
    rollupVariableBuckets,
    deleteExpiredVariableHourly,
  };
}

export type Storage = ReturnType<typeof createStorage>;
