/**
 * Per-stream config resolver used at ingest time: the tail-sampling / cap /
 * rate-limit policy the pipeline enforces. Cached in the shared platform cache
 * under `stream-config:<streamId>` (TTL 60s); a config change applies within that
 * window - acceptable staleness for cap/retention knobs. A stream that does not
 * exist resolves to the default policy (the ingest handler still rejects an
 * unknown TOKEN before this is reached).
 */

import type { SafeDatabase } from "@checkstack/backend-api";
import type { CachedScope } from "@checkstack/cache-utils";
import { eq } from "drizzle-orm";
import {
  DEFAULT_TRACE_STREAM_CONFIG,
  TraceStreamConfigSchema,
  type TraceStreamConfig,
} from "@checkstack/tracestream-common";
import * as schema from "../schema";
import { traceStreams } from "../schema";

export const STREAM_CONFIG_CACHE_TTL_MS = 60_000;

/** Cache key for a stream's resolved config (shared with any API invalidation). */
export function streamConfigCacheKey(streamId: string): string {
  return `stream-config:${streamId}`;
}

export interface StreamConfigResolver {
  resolve(streamId: string): Promise<TraceStreamConfig>;
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
            .select({ config: traceStreams.config })
            .from(traceStreams)
            .where(eq(traceStreams.id, streamId))
            .limit(1);
          if (!row) return DEFAULT_TRACE_STREAM_CONFIG;
          // Merge over defaults so a partially-populated config still parses.
          return TraceStreamConfigSchema.parse({
            ...DEFAULT_TRACE_STREAM_CONFIG,
            ...row.config,
          });
        },
        { ttlMs: STREAM_CONFIG_CACHE_TTL_MS },
      );
    },
  };
}
