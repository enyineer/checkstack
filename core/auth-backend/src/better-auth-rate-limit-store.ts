import { eq, lt } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import * as schema from "./schema";

/**
 * TTL after which a rate-limit row is definitively dead and safe to delete.
 *
 * better-auth's brute-force limiter uses a short fixed window (its default is
 * 60s; auth-backend does not configure custom per-path windows). Once `now -
 * lastRequest` exceeds the window, the counter has reset and the row is pure
 * dead weight — nothing reads it again. We delete with a deliberately generous
 * 24h margin (orders of magnitude larger than any plausible window) so a row
 * still inside its active window is NEVER pruned, even if better-auth's
 * defaults change. The DELETE is idempotent and shared-DB, so it is safe even
 * if more than one pod runs it.
 */
export const RATE_LIMIT_ROW_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * better-auth's built-in brute-force rate limiter (login, password reset, etc.)
 * defaults to `storage: "memory"` — a per-pod in-process Map. With N pods behind
 * one shared Postgres that multiplies the effective limit by N, which is a
 * horizontal-scale brute-force hole (state-and-scale §14.5) that a single-
 * process test can never catch.
 *
 * This module provides a `customStorage` adapter that persists better-auth's
 * rate-limit counters in the shared `better_auth_rate_limit` table, so the
 * counter is GLOBAL across every pod.
 *
 * The table shape mirrors better-auth's internal `RateLimit` record exactly:
 * `{ key, count, lastRequest }` where `lastRequest` is epoch milliseconds.
 */

/** A single better-auth rate-limit record (mirror of its internal shape). */
export interface BetterAuthRateLimitRecord {
  key: string;
  count: number;
  lastRequest: number;
}

/** The atomic storage interface better-auth 1.7's limiter calls. */
export interface BetterAuthRateLimitStorage {
  consume(
    key: string,
    rule: { window: number; max: number },
  ): Promise<{ allowed: boolean; retryAfter: number | null }>;
}

/**
 * Build a shared-Postgres `customStorage` for better-auth's rate limiter.
 *
 * Each consume runs inside a transaction. The insert-if-absent path handles a
 * new key, while the existing-row path locks the row before deciding whether
 * to reset, increment, or reject it. That keeps the request check and counter
 * update atomic across all pods.
 */
export function createBetterAuthRateLimitStore({
  db,
}: {
  db: SafeDatabase<typeof schema>;
}): BetterAuthRateLimitStorage {
  return {
    async consume(key, rule) {
      return db.transaction(async (tx) => {
        const inserted = await tx
          .insert(schema.betterAuthRateLimit)
          .values({ key, count: 1, lastRequest: Date.now() })
          .onConflictDoNothing()
          .returning({ key: schema.betterAuthRateLimit.key });

        if (inserted.length > 0) {
          return { allowed: true, retryAfter: null };
        }

        const rows = await tx
          .select({
            key: schema.betterAuthRateLimit.key,
            count: schema.betterAuthRateLimit.count,
            lastRequest: schema.betterAuthRateLimit.lastRequest,
          })
          .from(schema.betterAuthRateLimit)
          .where(eq(schema.betterAuthRateLimit.key, key))
          .for("update")
          .limit(1);

        const row = rows[0];
        if (!row) {
          throw new Error(
            "Better Auth rate-limit row disappeared during an atomic consume",
          );
        }

        const now = Date.now();
        const windowMs = rule.window * 1000;
        if (now - row.lastRequest >= windowMs) {
          await tx
            .update(schema.betterAuthRateLimit)
            .set({ count: 1, lastRequest: now })
            .where(eq(schema.betterAuthRateLimit.key, key));
          return { allowed: true, retryAfter: null };
        }

        if (row.count >= rule.max) {
          return {
            allowed: false,
            retryAfter: Math.max(
              0,
              Math.ceil((row.lastRequest + windowMs - now) / 1000),
            ),
          };
        }

        await tx
          .update(schema.betterAuthRateLimit)
          .set({ count: row.count + 1, lastRequest: now })
          .where(eq(schema.betterAuthRateLimit.key, key));
        return { allowed: true, retryAfter: null };
      });
    },
  };
}

/**
 * Delete rate-limit rows whose window has long elapsed.
 *
 * The `consume()` operation above never removes anything, so the table only
 * grows: one row per distinct `(ip, path)` brute-force key, forever. This sweeps rows whose
 * `lastRequest` is older than {@link RATE_LIMIT_ROW_TTL_MS} (epoch-ms compared
 * to epoch-ms), which is far past any active window — so a live counter is never
 * deleted. A single `DELETE ... WHERE last_request < cutoff` is idempotent and
 * runs against the shared DB, so concurrent pods converge harmlessly.
 *
 * @returns The number of rows deleted (so callers / tests can assert).
 */
export async function pruneExpiredBetterAuthRateLimits({
  db,
  now = Date.now(),
  ttlMs = RATE_LIMIT_ROW_TTL_MS,
}: {
  db: SafeDatabase<typeof schema>;
  /** Current time in epoch milliseconds. Injectable for tests. */
  now?: number;
  /** Override the deletion TTL. Defaults to {@link RATE_LIMIT_ROW_TTL_MS}. */
  ttlMs?: number;
}): Promise<{ deletedCount: number }> {
  const cutoff = now - ttlMs;
  const deleted = await db
    .delete(schema.betterAuthRateLimit)
    .where(lt(schema.betterAuthRateLimit.lastRequest, cutoff))
    .returning({ key: schema.betterAuthRateLimit.key });
  return { deletedCount: deleted.length };
}
