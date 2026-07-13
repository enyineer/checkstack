/**
 * Per-stream config resolver used at ingest time (body truncation caps) and
 * carried into the flush (sampling / raw caps). Cached in the shared platform
 * cache under `stream-config:<streamId>` (TTL 60s); a config change applies
 * within that window - acceptable staleness for sampling/retention knobs.
 */

import type { SafeDatabase } from "@checkstack/backend-api";
import type { CachedScope } from "@checkstack/cache-utils";
import { eq } from "drizzle-orm";
import {
  DEFAULT_LOG_STREAM_CONFIG,
  LogStreamConfigSchema,
  type LogStreamConfig,
} from "@checkstack/logstream-common";
import * as schema from "../schema";
import { logStreams } from "../schema";

export const STREAM_CONFIG_CACHE_TTL_MS = 60_000;

/** Cache key for a stream's resolved config (shared with any API invalidation). */
export function streamConfigCacheKey(streamId: string): string {
  return `stream-config:${streamId}`;
}

export interface StreamConfigResolver {
  resolve(streamId: string): Promise<LogStreamConfig>;
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
            .select({ config: logStreams.config })
            .from(logStreams)
            .where(eq(logStreams.id, streamId))
            .limit(1);
          if (!row) return DEFAULT_LOG_STREAM_CONFIG;
          // Merge over defaults so a partially-populated config still parses.
          return LogStreamConfigSchema.parse({
            ...DEFAULT_LOG_STREAM_CONFIG,
            ...row.config,
          });
        },
        { ttlMs: STREAM_CONFIG_CACHE_TTL_MS },
      );
    },
  };
}
