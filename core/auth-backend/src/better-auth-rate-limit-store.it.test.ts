/**
 * better-auth rate-limit store: shared-Postgres conformance.
 *
 * better-auth's built-in brute-force limiter defaults to per-pod in-memory
 * storage, which would let N pods each allow the cap = N x the intended limit
 * (state-and-scale §14.5). We back it with the shared `better_auth_rate_limit`
 * table; this test simulates TWO pods (two independent pools to the SAME schema)
 * and asserts a counter written on pod A is visible on pod B — i.e. the limiter
 * state is GLOBAL, not pod-local.
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

    it("a counter written on pod A is visible on pod B (global, not pod-local)", async () => {
      const storeA = createBetterAuthRateLimitStore({ db: podA.db });
      const storeB = createBetterAuthRateLimitStore({ db: podB.db });

      const key = "ip-203.0.113.5:/sign-in/email";
      await storeA.set(key, { key, count: 3, lastRequest: 1000 });

      // Pod B reads the SAME row written by pod A.
      const fromB = await storeB.get(key);
      expect(fromB).toEqual({ key, count: 3, lastRequest: 1000 });
    });

    it("set() upserts on subsequent updates (no duplicate-key error)", async () => {
      const storeA = createBetterAuthRateLimitStore({ db: podA.db });
      const key = "ip-198.51.100.9:/sign-in/email";

      await storeA.set(key, { key, count: 1, lastRequest: 1000 });
      // better-auth calls set() again with isUpdate=true on the next hit.
      await storeA.set(key, { key, count: 2, lastRequest: 2000 }, true);

      const after = await storeA.get(key);
      expect(after).toEqual({ key, count: 2, lastRequest: 2000 });
    });

    it("returns undefined for an unknown key", async () => {
      const storeB = createBetterAuthRateLimitStore({ db: podB.db });
      expect(await storeB.get("never-seen")).toBeUndefined();
    });

    it("pruneExpired deletes only rows past the TTL and leaves live ones", async () => {
      const store = createBetterAuthRateLimitStore({ db: podA.db });
      const now = 10_000_000_000; // arbitrary fixed "now" in epoch ms
      const ttlMs = 24 * 60 * 60 * 1000;

      // Earlier tests in this block share the same schema/table and leave rows
      // (with tiny `lastRequest` values) that prune would correctly sweep too.
      // Clear the table first so `deletedCount` reflects only this test's rows.
      await admin.query(`DELETE FROM "${SCHEMA}".better_auth_rate_limit`);

      const expiredKey = "prune-expired:/sign-in/email";
      const liveKey = "prune-live:/sign-in/email";
      const boundaryKey = "prune-boundary:/sign-in/email";

      // Older than the TTL — must be deleted.
      await store.set(expiredKey, {
        key: expiredKey,
        count: 5,
        lastRequest: now - ttlMs - 1,
      });
      // Well inside the TTL — must survive.
      await store.set(liveKey, {
        key: liveKey,
        count: 2,
        lastRequest: now - 1000,
      });
      // Exactly at the cutoff (not strictly less-than) — must survive.
      await store.set(boundaryKey, {
        key: boundaryKey,
        count: 1,
        lastRequest: now - ttlMs,
      });

      const { deletedCount } = await pruneExpiredBetterAuthRateLimits({
        db: podA.db,
        now,
        ttlMs,
      });

      expect(deletedCount).toBe(1);
      expect(await store.get(expiredKey)).toBeUndefined();
      expect(await store.get(liveKey)).toEqual({
        key: liveKey,
        count: 2,
        lastRequest: now - 1000,
      });
      expect(await store.get(boundaryKey)).toEqual({
        key: boundaryKey,
        count: 1,
        lastRequest: now - ttlMs,
      });

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
