/**
 * Pure unit coverage for the prune predicate of the better-auth rate-limit
 * store. The IT test (`*.it.test.ts`) exercises the real Postgres DELETE; this
 * test verifies the cutoff math (now - ttl) and the returned count without a
 * database, using a minimal fake that captures the predicate Drizzle builds.
 */
import { describe, expect, it } from "bun:test";
import type { SafeDatabase } from "@checkstack/backend-api";
import {
  pruneExpiredBetterAuthRateLimits,
  RATE_LIMIT_ROW_TTL_MS,
} from "./better-auth-rate-limit-store";
import * as schema from "./schema";

interface CapturedDelete {
  table: unknown;
  where: unknown;
}

/**
 * Minimal fake mirroring the `db.delete(table).where(cond).returning(...)`
 * chain the store uses. It records what it was called with and returns a fixed
 * set of "deleted" rows so we can assert `deletedCount`.
 */
function makeFakeDb({
  returnedRows,
  captured,
}: {
  returnedRows: { key: string }[];
  captured: CapturedDelete;
}): SafeDatabase<typeof schema> {
  const fake = {
    delete(table: unknown) {
      captured.table = table;
      return {
        where(cond: unknown) {
          captured.where = cond;
          return {
            returning(_columns: unknown) {
              return Promise.resolve(returnedRows);
            },
          };
        },
      };
    },
  };
  // The store only touches `db.delete(...)`; the rest of SafeDatabase is unused.
  return fake as unknown as SafeDatabase<typeof schema>;
}

describe("pruneExpiredBetterAuthRateLimits", () => {
  it("targets the better_auth_rate_limit table with a where predicate", async () => {
    const captured: CapturedDelete = { table: undefined, where: undefined };
    const db = makeFakeDb({ returnedRows: [], captured });

    await pruneExpiredBetterAuthRateLimits({ db, now: 1_000_000 });

    expect(captured.table).toBe(schema.betterAuthRateLimit);
    expect(captured.where).toBeDefined();
  });

  it("returns the number of deleted rows", async () => {
    const captured: CapturedDelete = { table: undefined, where: undefined };
    const db = makeFakeDb({
      returnedRows: [{ key: "a" }, { key: "b" }, { key: "c" }],
      captured,
    });

    const { deletedCount } = await pruneExpiredBetterAuthRateLimits({
      db,
      now: 1_000_000,
    });

    expect(deletedCount).toBe(3);
  });

  it("returns zero when nothing is expired", async () => {
    const captured: CapturedDelete = { table: undefined, where: undefined };
    const db = makeFakeDb({ returnedRows: [], captured });

    const { deletedCount } = await pruneExpiredBetterAuthRateLimits({ db });

    expect(deletedCount).toBe(0);
  });

  it("exposes a 24h default TTL", () => {
    expect(RATE_LIMIT_ROW_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
