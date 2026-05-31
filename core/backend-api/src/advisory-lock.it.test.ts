/**
 * Integration test (real Postgres) for the advisory-lock service.
 *
 * This is part of the surgical integration lane (plan §14.4 #1). It pins the
 * one behaviour fakes cannot model faithfully: Postgres session-level advisory
 * locks are tied to the DB *connection* that acquired them, so the holding
 * client must be the same one that releases — and killing the holding
 * connection must auto-release the lock.
 *
 * Gated behind `CHECKSTACK_IT=1` so the default `bun test` never runs it. The
 * `integration` CI job sets that flag and provides a real Postgres service
 * container. Connection comes from `CHECKSTACK_IT_PG_URL` (defaulting to the
 * `docker-compose-dev.yml` Postgres port).
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Pool } from "pg";
import { createAdvisoryLockService } from "./advisory-lock";

const PG_URL =
  process.env.CHECKSTACK_IT_PG_URL ??
  "postgres://postgres:postgres@localhost:5432/postgres";

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "advisory-lock (real Postgres)",
  () => {
    let pool: Pool;

    beforeAll(() => {
      pool = new Pool({ connectionString: PG_URL });
      // A pooled client can error asynchronously while idle (e.g. its backend
      // is terminated by the kill test below). pg emits that on the pool; with
      // no handler it surfaces as an unhandled "Connection terminated
      // unexpectedly" error that fails the whole test file. Swallowing idle-
      // client errors is the documented pg pattern - the tests still assert
      // behaviour through fresh checkouts.
      pool.on("error", () => {});
    });

    afterAll(async () => {
      await pool.end();
    });

    it("a second tryAcquire of the same key returns null until release", async () => {
      const service = createAdvisoryLockService(pool);
      const key = `it-advisory-lock:${crypto.randomUUID()}`;

      const first = await service.tryAcquire(key);
      expect(first).not.toBeNull();

      // The lock is held — a concurrent acquire of the SAME key must fail.
      const second = await service.tryAcquire(key);
      expect(second).toBeNull();

      // After release, a third acquire succeeds.
      await first?.release();
      const third = await service.tryAcquire(key);
      expect(third).not.toBeNull();
      await third?.release();
    });

    it("killing the holding connection auto-releases the lock", async () => {
      const service = createAdvisoryLockService(pool);
      const key = `it-advisory-lock:${crypto.randomUUID()}`;

      // Acquire on a dedicated client owned by the handle.
      const held = await service.tryAcquire(key);
      expect(held).not.toBeNull();

      // While held, the key is unavailable.
      const blocked = await service.tryAcquire(key);
      expect(blocked).toBeNull();

      // Terminate ONLY the backend holding the advisory lock - found via
      // `pg_locks` - from a fresh connection. Dropping that session makes
      // Postgres auto-release the lock. We deliberately do NOT kill every other
      // backend (the old approach): that also terminated the pool's idle
      // connections, whose async "connection terminated" errors flaked the test
      // and left the pool unusable. The handle holds exactly one advisory lock,
      // so this targets precisely the holder.
      const killer = await pool.connect();
      try {
        await killer.query(
          `SELECT pg_terminate_backend(pid)
             FROM pg_locks
            WHERE locktype = 'advisory'
              AND pid <> pg_backend_pid()`,
        );
      } finally {
        killer.release();
      }

      // The lock should now be acquirable again. Retry briefly because the
      // server takes a moment to reap the terminated backend's session locks.
      let reacquired: Awaited<ReturnType<typeof service.tryAcquire>> = null;
      for (let attempt = 0; attempt < 20 && reacquired === null; attempt++) {
        reacquired = await service.tryAcquire(key);
        if (reacquired === null) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      expect(reacquired).not.toBeNull();
      await reacquired?.release();

      // The `held` handle still owns its (now-terminated) client. Release it so
      // the dead client is returned to the pool - otherwise `pool.end()` in
      // afterAll blocks waiting for the checked-out client to drain. The unlock
      // query runs against a dead connection and rejects; that's expected.
      await held?.release().catch(() => {});
    });
  },
);
