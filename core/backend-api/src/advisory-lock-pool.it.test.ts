/**
 * Integration test (real Postgres) for the advisory-lock CONNECTION-POOL
 * contract — the behaviour that silently wedged production and that fakes
 * cannot model: a held advisory lock keeps its connection checked out while the
 * gated work runs on a *different* connection, so lock-pool / work-pool sizing
 * decides whether the system makes progress or deadlocks.
 *
 * It pins three things against a live server:
 *
 *   1. REPRODUCE THE BUG: when the lock and its work share ONE pool, concurrency
 *      at the pool size deadlocks (every slot is a lock-holder waiting for a
 *      work connection that can never free up). This is a guard — if a refactor
 *      makes this stop deadlocking, the throughput test below is no longer
 *      proving anything.
 *   2. THE FIX: with the lock on a DEDICATED pool, the same (and much higher)
 *      concurrency completes with zero failures.
 *   3. CORRECTNESS ACROSS INSTANCES: independent service instances with their
 *      OWN pools (simulating N pods on one database) serialize a find-then-
 *      create on a shared key down to exactly ONE row — with a no-lock control
 *      proving the lock is what enforces it.
 *
 * Gated behind `CHECKSTACK_IT=1`; the integration CI job provides the Postgres
 * service container. Connection from `CHECKSTACK_IT_PG_URL`.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Pool } from "pg";
import { createAdvisoryLockService } from "./advisory-lock";

const PG_URL =
  process.env.CHECKSTACK_IT_PG_URL ??
  "postgres://postgres:postgres@localhost:5432/postgres";

const DEDUP_TABLE = "it_advisory_dedup";

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "advisory-lock pool contract (real Postgres)",
  () => {
    /** Pools created during a test; ended in afterEach-style cleanup helpers. */
    const tracked: Pool[] = [];
    function makePool(max: number, connectionTimeoutMillis = 5000): Pool {
      const pool = new Pool({
        connectionString: PG_URL,
        max,
        connectionTimeoutMillis,
        idleTimeoutMillis: 1000,
      });
      // A held-lock client can error asynchronously (timeout / termination);
      // swallow so it never surfaces as an unhandled error and fails the file.
      pool.on("error", () => {});
      tracked.push(pool);
      return pool;
    }
    async function endTrackedPools(): Promise<void> {
      await Promise.all(tracked.splice(0).map((p) => p.end().catch(() => {})));
    }

    let setupPool: Pool;
    beforeAll(async () => {
      setupPool = new Pool({ connectionString: PG_URL });
      await setupPool.query(
        `CREATE TABLE IF NOT EXISTS ${DEDUP_TABLE} (lock_key text NOT NULL, id text NOT NULL)`,
      );
    });
    afterAll(async () => {
      await setupPool.query(`DROP TABLE IF EXISTS ${DEDUP_TABLE}`);
      await setupPool.end();
      await endTrackedPools();
    });

    /**
     * Find-then-create on `workPool`: insert exactly once per key. The 15ms gap
     * between the read and the write widens the race window so an UNSERIALIZED
     * run reliably double-inserts — making the lock's effect observable.
     */
    async function dedupCreate(workPool: Pool, key: string): Promise<boolean> {
      const client = await workPool.connect();
      try {
        const { rows } = await client.query(
          `SELECT id FROM ${DEDUP_TABLE} WHERE lock_key = $1 LIMIT 1`,
          [key],
        );
        if (rows.length > 0) return false;
        await new Promise((r) => setTimeout(r, 15));
        await client.query(
          `INSERT INTO ${DEDUP_TABLE} (lock_key, id) VALUES ($1, $2)`,
          [key, crypto.randomUUID()],
        );
        return true;
      } finally {
        client.release();
      }
    }

    async function countFor(key: string): Promise<number> {
      const { rows } = await setupPool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${DEDUP_TABLE} WHERE lock_key = $1`,
        [key],
      );
      return Number(rows[0]?.n ?? "0");
    }

    it(
      "REPRODUCES the deadlock when lock + work share one pool (the bug)",
      async () => {
        const POOL_MAX = 4;
        // Single shared pool — the pre-fix wiring. The lock client AND the work
        // client both come from here. Short connect timeout so the deadlock
        // surfaces as a fast rejection rather than a long hang.
        const pool = makePool(POOL_MAX, 1500);
        const svc = createAdvisoryLockService(pool);
        const runId = crypto.randomUUID();

        // Exactly POOL_MAX concurrent ops, each on a DISTINCT key (so there is
        // NO lock contention — the only thing that can stall is connection
        // accounting). Each holds a lock client, then asks the same pool for a
        // work client that will never come.
        const results = await Promise.allSettled(
          Array.from({ length: POOL_MAX }, (_, i) =>
            svc.withXactLock({
              key: `deadlock:${runId}:${i}`,
              fn: async () => {
                const c = await pool.connect();
                try {
                  await c.query("SELECT 1");
                } finally {
                  c.release();
                }
              },
            }),
          ),
        );

        const rejected = results.filter((r) => r.status === "rejected").length;
        // The deadlock manifests as connection-acquire timeouts on the work
        // checkout. If this ever becomes 0, the single-pool design no longer
        // deadlocks and the throughput proof below must be re-examined.
        expect(rejected).toBeGreaterThan(0);

        await endTrackedPools();
      },
      30_000,
    );

    it(
      "does NOT deadlock under high throughput with a dedicated lock pool (the fix)",
      async () => {
        // Deliberately TINY pools so any deadlock would be hit immediately; the
        // fix is that lock and work draw from different pools.
        const lockPool = makePool(4);
        const workPool = makePool(4);
        const svc = createAdvisoryLockService(lockPool);
        const runId = crypto.randomUUID();

        const CONCURRENCY = 200;
        const results = await Promise.allSettled(
          Array.from({ length: CONCURRENCY }, (_, i) =>
            svc.withXactLock({
              key: `throughput:${runId}:${i}`,
              fn: async () => {
                const c = await workPool.connect();
                try {
                  await c.query("SELECT 1");
                } finally {
                  c.release();
                }
              },
            }),
          ),
        );

        const rejected = results.filter((r) => r.status === "rejected");
        // Every single operation must complete: no deadlock, no timeout.
        expect(rejected).toHaveLength(0);

        await endTrackedPools();
      },
      30_000,
    );

    it(
      "serializes find-then-create across INSTANCES to exactly one row",
      async () => {
        // Each "pod" is an independent service instance with its OWN pools, all
        // pointing at the same database — the real multi-instance topology. The
        // advisory lock space is global to the server, so they must serialize.
        const PODS = 6;
        const ATTEMPTS_PER_POD = 5;
        const key = `dedupe:${crypto.randomUUID()}`;

        const pods = Array.from({ length: PODS }, () => {
          const workPool = makePool(2);
          const svc = createAdvisoryLockService(makePool(2));
          return { workPool, svc };
        });

        const attempts = pods.flatMap((pod) =>
          Array.from({ length: ATTEMPTS_PER_POD }, () =>
            pod.svc.withXactLock({
              key,
              fn: () => dedupCreate(pod.workPool, key),
            }),
          ),
        );

        const settled = await Promise.allSettled(attempts);
        const created = settled.filter(
          (r) => r.status === "fulfilled" && r.value === true,
        ).length;

        // Exactly one attempt created the row; the rest observed it and no-oped.
        expect(await countFor(key)).toBe(1);
        expect(created).toBe(1);

        await endTrackedPools();
      },
      30_000,
    );

    it(
      "a STALLED critical section is reaped by idle_in_transaction_session_timeout, freeing the key",
      async () => {
        // The lock pool sets a short idle-in-transaction timeout. A held lock
        // sits "idle in transaction" for the whole time `fn` runs, so a hung
        // `fn` trips it: Postgres aborts the session, auto-releasing the lock -
        // proving a stall self-heals instead of stranding the key forever.
        const lockPool = new Pool({
          connectionString: PG_URL,
          max: 4,
          connectionTimeoutMillis: 5000,
          idle_in_transaction_session_timeout: 1000,
        });
        lockPool.on("error", () => {});
        tracked.push(lockPool);
        const svc = createAdvisoryLockService(lockPool);
        const key = `stall:${crypto.randomUUID()}`;

        let releaseHang!: () => void;
        const hang = new Promise<void>((r) => (releaseHang = r));

        // Holder whose critical section hangs (never issues another query).
        const stalled = svc
          .withXactLock({ key, fn: () => hang })
          .catch(() => "rejected-as-expected");

        // Wait past the 1s idle timeout so the server reaps the stalled holder.
        await new Promise((r) => setTimeout(r, 1800));

        // The key must be acquirable again now that the stalled session was
        // aborted server-side.
        const t0 = Date.now();
        const got = await svc.withXactLock({ key, fn: async () => "ok" });
        expect(got).toBe("ok");
        expect(Date.now() - t0).toBeLessThan(3000);

        releaseHang();
        await stalled; // let the stalled call unwind (COMMIT fails on dead conn)
        await endTrackedPools();
      },
      30_000,
    );

    it(
      "CONTROL: the same workload WITHOUT the lock races into duplicates",
      async () => {
        // Proves the lock — not some incidental ordering — is what enforces
        // single-creation above. Same widened-window find-then-create, run
        // concurrently with NO advisory lock, must double-insert.
        const workPool = makePool(8);
        const key = `dedupe-nolock:${crypto.randomUUID()}`;

        await Promise.all(
          Array.from({ length: 8 }, () => dedupCreate(workPool, key)),
        );

        expect(await countFor(key)).toBeGreaterThan(1);

        await endTrackedPools();
      },
      30_000,
    );
  },
);
