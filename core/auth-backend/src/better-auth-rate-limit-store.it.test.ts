/**
 * better-auth rate-limit store: shared-Postgres conformance.
 *
 * better-auth's built-in brute-force limiter defaults to per-pod in-memory
 * storage, which would let N pods each allow the cap = N x the intended limit
 * (state-and-scale §14.5). We back it with the shared `better_auth_rate_limit`
 * table; this test simulates TWO pods (two independent pools to the SAME schema)
 * and asserts a counter consumed on pod A is enforced on pod B — i.e. the
 * limiter state is GLOBAL, not pod-local.
 *
 * Gated behind `CHECKSTACK_IT=1`; connection from `CHECKSTACK_IT_PG_URL`. Runs
 * in a freshly created, self-cleaning schema.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { SafeDatabase } from "@checkstack/backend-api";
import * as schema from "./schema";
import {
  createBetterAuthRateLimitStore,
  pruneExpiredBetterAuthRateLimits,
} from "./better-auth-rate-limit-store";

const PG_URL =
  process.env.CHECKSTACK_IT_PG_URL ??
  "postgres://postgres:postgres@localhost:5432/postgres";

const SCHEMA = `it_ba_ratelimit_${crypto.randomUUID().replace(/-/g, "")}`;

interface Pod {
  pool: Pool;
  db: SafeDatabase<typeof schema>;
  end(): Promise<void>;
}

function makePod(): Pod {
  const pool = new Pool({
    connectionString: PG_URL,
    options: `-c search_path=${SCHEMA}`,
  });
  const db = drizzle(pool, { schema }) as unknown as SafeDatabase<typeof schema>;
  return { pool, db, end: () => pool.end() };
}

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "better-auth rate-limit store (shared Postgres)",
  () => {
    let admin: Pool;
    let podA: Pod;
    let podB: Pod;

    beforeAll(async () => {
      admin = new Pool({ connectionString: PG_URL });
      await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
      await admin.query(
        `CREATE TABLE "${SCHEMA}".better_auth_rate_limit (
          key text PRIMARY KEY NOT NULL,
          count integer NOT NULL DEFAULT 0,
          last_request bigint NOT NULL DEFAULT 0
        )`,
      );
      podA = makePod();
      podB = makePod();
    });

    afterAll(async () => {
      await podA?.end();
      await podB?.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.end();
    });

    it("enforces one global counter across pods", async () => {
      const storeA = createBetterAuthRateLimitStore({ db: podA.db });
      const storeB = createBetterAuthRateLimitStore({ db: podB.db });

      const key = "ip-203.0.113.5:/sign-in/email";
      const rule = { window: 60, max: 2 };

      expect(await storeA.consume(key, rule)).toEqual({
        allowed: true,
        retryAfter: null,
      });
      expect(await storeB.consume(key, rule)).toEqual({
        allowed: true,
        retryAfter: null,
      });

      // A third request is rejected by the SAME row, regardless of which pod
      // performs the check.
      const rejected = await storeA.consume(key, rule);
      expect(rejected.allowed).toBe(false);
      expect(rejected.retryAfter).toBeGreaterThan(0);
    });

    it("allows exactly the configured number of concurrent requests", async () => {
      const storeA = createBetterAuthRateLimitStore({ db: podA.db });
      const storeB = createBetterAuthRateLimitStore({ db: podB.db });
      const key = "ip-198.51.100.9:/sign-in/email";
      const rule = { window: 60, max: 3 };

      const results = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          (index % 2 === 0 ? storeA : storeB).consume(key, rule),
        ),
      );

      expect(results.filter((result) => result.allowed)).toHaveLength(3);
      expect(results.filter((result) => !result.allowed)).toHaveLength(9);
    });

    it("pruneExpired deletes only rows past the TTL and leaves live ones", async () => {
      const now = 10_000_000_000; // arbitrary fixed "now" in epoch ms
      const ttlMs = 24 * 60 * 60 * 1000;

      // Earlier tests in this block share the same schema/table and leave rows
      // (with tiny `lastRequest` values) that prune would correctly sweep too.
      // Clear the table first so `deletedCount` reflects only this test's rows.
      await admin.query(`DELETE FROM "${SCHEMA}".better_auth_rate_limit`);

      const expiredKey = "prune-expired:/sign-in/email";
      const liveKey = "prune-live:/sign-in/email";
      const boundaryKey = "prune-boundary:/sign-in/email";

      // Seed historical rows directly because consume() timestamps requests
      // with the process clock; the prune operation itself is what this test
      // exercises.
      await admin.query(
        `INSERT INTO "${SCHEMA}".better_auth_rate_limit
          (key, count, last_request) VALUES
          ($1, $2, $3), ($4, $5, $6), ($7, $8, $9)`,
        [
          expiredKey,
          5,
          now - ttlMs - 1,
          liveKey,
          2,
          now - 1000,
          boundaryKey,
          1,
          now - ttlMs,
        ],
      );

      const { deletedCount } = await pruneExpiredBetterAuthRateLimits({
        db: podA.db,
        now,
        ttlMs,
      });

      expect(deletedCount).toBe(1);
      const remaining = await admin.query<{ key: string }>(
        `SELECT key FROM "${SCHEMA}".better_auth_rate_limit
         WHERE key = ANY($1::text[]) ORDER BY key`,
        [[expiredKey, liveKey, boundaryKey]],
      );
      expect(remaining.rows.map((row) => row.key)).toEqual([
        boundaryKey,
        liveKey,
      ].sort());

      // Idempotent: a second sweep over the same cutoff deletes nothing.
      const second = await pruneExpiredBetterAuthRateLimits({
        db: podA.db,
        now,
        ttlMs,
      });
      expect(second.deletedCount).toBe(0);
    });
  },
);
