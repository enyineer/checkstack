import type { ScopedQueryRunner } from "@checkstack/backend-api";
import * as schema from "../schema";
import { logEvents } from "../schema";
import { chunk, STORAGE_CHUNK_SIZE } from "./time";

type Runner = ScopedQueryRunner<typeof schema>;

/** An insertable raw-line row (identity `id` is assigned by Postgres). */
export type NewLogEvent = typeof logEvents.$inferInsert;

/**
 * Insert kept raw lines with multi-row inserts chunked at
 * {@link STORAGE_CHUNK_SIZE}. The caller MUST pass a runner already inside the
 * flush transaction, so the whole flush is one `SET LOCAL search_path` /
 * connection checkout - NEVER one transaction per line.
 */
export async function insertLogEventsBatch({
  runner,
  rows,
}: {
  runner: Runner;
  rows: NewLogEvent[];
}): Promise<void> {
  if (rows.length === 0) return;
  for (const part of chunk({ items: rows, size: STORAGE_CHUNK_SIZE })) {
    await runner.insert(logEvents).values(part);
  }
}
