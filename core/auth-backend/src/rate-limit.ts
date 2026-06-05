import { sql } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import * as schema from "./schema";

/**
 * Shared-Postgres fixed-window rate limiter (state-and-scale §14.5).
 *
 * The counter lives in the `ai_rate_limit` table, so the cap holds across ALL
 * pods — an in-memory per-pod limiter would let N pods each allow the cap, i.e.
 * N x the intended limit, which a single-process test would never catch. This
 * is LOCKED: the limiter MUST be Postgres-backed, never in-memory.
 *
 * Each call atomically bumps the counter for `(key, windowStart)` and returns
 * the post-increment count, so the increment + read is a single round-trip with
 * no read-modify-write race between pods.
 */

/** Floor a timestamp to the start of its fixed window. */
export function windowStartFor({
  now,
  windowSeconds,
}: {
  now: Date;
  windowSeconds: number;
}): Date {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

export interface RateLimitResult {
  /** Count AFTER this call's increment. */
  count: number;
  /** Whether this call is within the limit (`count <= max`). */
  allowed: boolean;
  /** The window this call was counted against. */
  windowStart: Date;
}

/**
 * Atomically increment and check a fixed-window counter.
 *
 * Returns `{ allowed: false }` when the post-increment count exceeds `max`.
 * Callers decide the response (e.g. 429 for the DCR endpoint).
 */
export async function checkRateLimit({
  db,
  key,
  max,
  windowSeconds,
  now = new Date(),
}: {
  db: SafeDatabase<typeof schema>;
  key: string;
  max: number;
  windowSeconds: number;
  now?: Date;
}): Promise<RateLimitResult> {
  const windowStart = windowStartFor({ now, windowSeconds });

  // INSERT ... ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1
  // RETURNING count. Single atomic statement: no read-modify-write race.
  const rows = await db
    .insert(schema.aiRateLimit)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [schema.aiRateLimit.key, schema.aiRateLimit.windowStart],
      set: { count: sql`${schema.aiRateLimit.count} + 1` },
    })
    .returning({ count: schema.aiRateLimit.count });

  const count = rows[0]?.count ?? 1;
  return { count, allowed: count <= max, windowStart };
}
