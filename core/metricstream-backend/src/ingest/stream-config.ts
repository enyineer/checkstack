/**
 * Per-stream config resolver used at ingest time: the cardinality cap
 * (`seriesCap`), the per-request datapoint cap (`maxDatapointsPerRequest`) and
 * the soft per-minute rate limit (`softDatapointsPerMinute`). Cached in the
 * shared platform cache under `stream-config:<streamId>` (TTL 60s); a config
 * change applies within that window - acceptable staleness for cap/retention
 * knobs. A stream that does not exist resolves to the default policy (the
 * ingest handler still rejects an unknown TOKEN before this is reached).
 */

import type { SafeDatabase } from "@checkstack/backend-api";
import type { CachedScope } from "@checkstack/cache-utils";
import { eq } from "drizzle-orm";
import {
  DEFAULT_METRIC_STREAM_CONFIG,
  MetricStreamConfigSchema,
  type MetricStreamConfig,
} from "@checkstack/metricstream-common";
import * as schema from "../schema";
import { metricStreams } from "../schema";

export const STREAM_CONFIG_CACHE_TTL_MS = 60_000;

/** Cache key for a stream's resolved config (shared with any API invalidation). */
export function streamConfigCacheKey(streamId: string): string {
  return `stream-config:${streamId}`;
}

export interface StreamConfigResolver {
  resolve(streamId: string): Promise<MetricStreamConfig>;
}

export function createStreamConfigResolver({
  db,
  cache,
}: {
  db: SafeDatabase<typeof schema>;
  cache: CachedScope;
}): StreamConfigResolver {
  return {
    resolve(streamId) {
      return cache.wrap(
        streamConfigCacheKey(streamId),
        async () => {
          const [row] = await db
            .select({ config: metricStreams.config })
            .from(metricStreams)
            .where(eq(metricStreams.id, streamId))
            .limit(1);
          if (!row) return DEFAULT_METRIC_STREAM_CONFIG;
          // Merge over defaults so a partially-populated config still parses.
          return MetricStreamConfigSchema.parse({
            ...DEFAULT_METRIC_STREAM_CONFIG,
            ...row.config,
          });
        },
        { ttlMs: STREAM_CONFIG_CACHE_TTL_MS },
      );
    },
  };
}
