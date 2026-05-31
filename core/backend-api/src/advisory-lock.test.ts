import { describe, it, expect } from "bun:test";
import {
  createAdvisoryLockService,
  type AdvisoryLockPool,
  type AdvisoryLockPoolClient,
} from "./advisory-lock";

/**
 * Faithful fake of a `pg.Pool` that models Postgres' per-connection
 * SESSION advisory-lock semantics:
 *
 *   - A key can be held by at most one connection at a time.
 *   - `pg_try_advisory_lock` succeeds only if the key is free; it then
 *     binds the key to the acquiring connection.
 *   - `pg_advisory_unlock` only frees the key if THIS connection holds it
 *     (a no-op otherwise) — exactly the bug we are guarding against: an
 *     unlock issued on a different connection does nothing.
 *
 * This lets the test prove the service keeps acquire + release on ONE
 * client.
 */
interface FakePool extends AdvisoryLockPool {
  checkedOut: number;
  released: number;
}

function makeFakePool(): FakePool {
  // key -> owning connection id (or absent if free)
  const heldBy = new Map<string, number>();
  let nextConnId = 0;
  const counters = { checkedOut: 0, released: 0 };

  // hashtextextended($1, 0) is opaque here — we just key on the raw string,
  // which is faithful since the SQL is deterministic per key.
  function keyOf(values: unknown[] | undefined): string {
    return String(values?.[0]);
  }

  return {
    get checkedOut() {
      return counters.checkedOut;
    },
    get released() {
      return counters.released;
    },
    async connect(): Promise<AdvisoryLockPoolClient> {
      const connId = nextConnId++;
      counters.checkedOut++;
      return {
        async query<T>(queryText: string, values?: unknown[]) {
          const key = keyOf(values);
          if (queryText.includes("pg_try_advisory_lock")) {
            const owner = heldBy.get(key);
            const ok = owner === undefined;
            if (ok) heldBy.set(key, connId);
            return { rows: [{ ok } as unknown as T] };
          }
          if (queryText.includes("pg_advisory_unlock")) {
            // Only the owning connection can release — model the leak bug.
            if (heldBy.get(key) === connId) heldBy.delete(key);
            return { rows: [{ ok: true } as unknown as T] };
          }
          return { rows: [] };
        },
        release() {
          counters.released++;
        },
        on() {
          // The fake never emits async client errors; the real client's
          // `on('error')` hardening is exercised by the IT against real
          // Postgres (killing the holding connection).
        },
      };
    },
  };
}

describe("createAdvisoryLockService", () => {
  it("acquire → second acquire fails while held → release → third acquire succeeds", async () => {
    const pool = makeFakePool();
    const svc = createAdvisoryLockService(pool);

    const first = await svc.tryAcquire("k");
    expect(first).not.toBeNull();

    // Held: a second acquire (different pooled connection) must fail.
    const second = await svc.tryAcquire("k");
    expect(second).toBeNull();

    // Release on the SAME client that acquired (the bug is release no-op'ing
    // because it ran on a different connection).
    await first!.release();

    const third = await svc.tryAcquire("k");
    expect(third).not.toBeNull();
    await third!.release();
  });

  it("returns the client to the pool on both the failed-acquire and release paths", async () => {
    const pool = makeFakePool();
    const svc = createAdvisoryLockService(pool);

    const h = await svc.tryAcquire("k");
    const blocked = await svc.tryAcquire("k"); // fails → must release client
    expect(blocked).toBeNull();
    await h!.release();

    // 2 connects (one held+released, one failed+released) => 2 releases.
    expect(pool.checkedOut).toBe(2);
    expect(pool.released).toBe(2);
  });

  it("release is idempotent", async () => {
    const pool = makeFakePool();
    const svc = createAdvisoryLockService(pool);
    const h = await svc.tryAcquire("k");
    await h!.release();
    await h!.release(); // no throw, no double client.release
    expect(pool.released).toBe(1);
  });

  it("different keys do not block each other", async () => {
    const pool = makeFakePool();
    const svc = createAdvisoryLockService(pool);
    const a = await svc.tryAcquire("a");
    const b = await svc.tryAcquire("b");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    await a!.release();
    await b!.release();
  });
});
