/**
 * The main-thread pattern-row loader used to answer worker hydrate-requests. A
 * worker holds no DB connection, so when it seeds a stream's Drain tree it asks
 * the main thread, which runs this query and returns the rows. It reads the same
 * `log_patterns` columns the in-process engine hydrates from, so a worker tree
 * seeds identically to a main-thread one - including the same
 * {@link HYDRATION_ROW_LIMIT} bound, so a pathological table cannot OOM a worker
 * either. Because the worker's own engine has no logger, the truncation warning
 * is emitted here (the main thread holds the logger).
 */

import { desc, eq } from "drizzle-orm";
import type { Logger } from "@checkstack/backend-api";
import { HYDRATION_ROW_LIMIT, type LoadPatternRows } from "../../drain/engine";
import type { Storage } from "../../storage";
import { logPatterns } from "../../schema";

/** Build a {@link LoadPatternRows} backed by `storage`'s database. */
export function createDbPatternLoader({
  storage,
  logger,
}: {
  storage: Storage;
  logger: Logger;
}): LoadPatternRows {
  return async ({ streamId }) => {
    // Bounded to the most-recently-seen rows (see HYDRATION_ROW_LIMIT); the
    // ORDER BY + LIMIT is served by `log_patterns_stream_last_seen_idx`.
    const rows = await storage.db
      .select({
        id: logPatterns.id,
        template: logPatterns.template,
        origin: logPatterns.origin,
      })
      .from(logPatterns)
      .where(eq(logPatterns.streamId, streamId))
      .orderBy(desc(logPatterns.lastSeenAt))
      .limit(HYDRATION_ROW_LIMIT);
    if (rows.length >= HYDRATION_ROW_LIMIT) {
      logger.warn(
        `logstream: stream ${streamId} hydration truncated at ${HYDRATION_ROW_LIMIT} patterns (coldest patterns will re-mine on next line)`,
      );
    }
    return rows;
  };
}
