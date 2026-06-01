import { describe, it, expect } from "bun:test";
import {
  createAdvisoryLockService,
  type AdvisoryLockPool,
  type AdvisoryLockPoolClient,
} from "./advisory-lock";

/**
 * Faithful fake of a `pg.Pool` that models Postgres' per-connection
 * advisory-lock semantics for BOTH lock flavours:
 *
 * SESSION locks (`tryAcquire`):
 *   - A key can be held by at most one connection at a time.
 *   - `pg_try_advisory_lock` succeeds only if the key is free; it then
 *     binds the key to the acquiring connection.
 *   - `pg_advisory_unlock` only frees the key if THIS connection holds it
 *     (a no-op otherwise) — exactly the bug we are guarding against: an
 *     unlock issued on a different connection does nothing.
 *
 * TRANSACTION locks (`withXactLock`):
 *   - `pg_advisory_xact_lock` BLOCKS until the key is free, then binds it to
 *     the acquiring connection's transaction.
 *   - `COMMIT` / `ROLLBACK` release every xact lock held by that connection
 *     and wake the next blocked waiter (FIFO) — modelling auto-release and
 *     the serialization guarantee.
 *
 * This lets the tests prove the service keeps acquire + release on ONE
 * client and that concurrent `withXactLock` callers serialize.
 */
interface FakePool extends AdvisoryLockPool {
  checkedOut: number;
  released: number;
}

function makeFakePool(): FakePool {
  // key -> owning connection id (or absent if free)
  const heldBy = new Map<string, number>();
  // xact key -> owning connection id; waiters queued FIFO per key.
  const xactHeldBy = new Map<string, number>();
  const xactWaiters = new Map<string, Array<() => void>>();
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
      const releaseXactLocks = () => {
        for (const [key, owner] of [...xactHeldBy.entries()]) {
          if (owner !== connId) continue;
          xactHeldBy.delete(key);
          const next = xactWaiters.get(key)?.shift();
          if (next) next();
        }
      };
      return {
        async query<T>(queryText: string, values?: unknown[]) {
          if (queryText === "BEGIN") return { rows: [] };
          if (queryText === "COMMIT" || queryText === "ROLLBACK") {
            releaseXactLocks();
            return { rows: [] };
          }
          const key = keyOf(values);
          if (queryText.includes("pg_try_advisory_lock")) {
            const owner = heldBy.get(key);
            const ok = owner === undefined;
            if (ok) heldBy.set(key, connId);
            return { rows: [{ ok } as unknown as T] };
          }
          if (queryText.includes("pg_advisory_xact_lock")) {
            if (!xactHeldBy.has(key)) {
              xactHeldBy.set(key, connId);
              return { rows: [] };
            }
            // Blocked: enqueue and wait until a holder commits/rolls back.
            await new Promise<void>((resolve) => {
              const q = xactWaiters.get(key) ?? [];
              q.push(() => {
                xactHeldBy.set(key, connId);
                resolve();
              });
              xactWaiters.set(key, q);
            });
            return { rows: [] };
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
        off() {
          // Counterpart to `on`; the service detaches its error listener on
          // release. No-op here since the fake never attaches one.
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

describe("createAdvisoryLockService.withXactLock", () => {
  const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

  it("runs fn, returns its value, and releases the client", async () => {
    const pool = makeFakePool();
    const svc = createAdvisoryLockService(pool);
    const result = await svc.withXactLock({ key: "k", fn: async () => 42 });
    expect(result).toBe(42);
    expect(pool.checkedOut).toBe(1);
    expect(pool.released).toBe(1);
  });

  it("serializes concurrent calls on the same key (second fn waits for first to commit)", async () => {
    const pool = makeFakePool();
    const svc = createAdvisoryLockService(pool);
    const order: string[] = [];

    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((r) => (releaseFirst = r));

    const p1 = svc.withXactLock({
      key: "k",
      fn: async () => {
        order.push("1-start");
        await firstHeld;
        order.push("1-end");
      },
    });

    // Let p1 acquire the lock before p2 attempts it.
    await tick();
    const p2 = svc.withXactLock({
      key: "k",
      fn: async () => {
        order.push("2-start");
      },
    });

    // While p1 holds the lock, p2's fn must NOT have started.
    await tick();
    expect(order).toEqual(["1-start"]);

    releaseFirst();
    await Promise.all([p1, p2]);
    expect(order).toEqual(["1-start", "1-end", "2-start"]);
    expect(pool.released).toBe(2);
  });

  it("rolls back and releases the client when fn throws, freeing the lock", async () => {
    const pool = makeFakePool();
    const svc = createAdvisoryLockService(pool);

    await expect(
      svc.withXactLock({
        key: "k",
        fn: async () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");

    // Lock was released on rollback: a subsequent acquire succeeds promptly.
    const after = await svc.withXactLock({ key: "k", fn: async () => "ok" });
    expect(after).toBe("ok");
    expect(pool.released).toBe(2);
  });

  it("different keys do not serialize", async () => {
    const pool = makeFakePool();
    const svc = createAdvisoryLockService(pool);
    const started: string[] = [];

    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));

    const pA = svc.withXactLock({
      key: "a",
      fn: async () => {
        started.push("a");
        await held;
      },
    });
    await tick();
    // Key "b" must run even while "a" is still held.
    await svc.withXactLock({
      key: "b",
      fn: async () => {
        started.push("b");
      },
    });
    expect(started).toContain("b");

    release();
    await pA;
  });
});
