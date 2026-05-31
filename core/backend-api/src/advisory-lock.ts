/**
 * Postgres advisory-lock helpers with correct connection affinity.
 *
 * Postgres session-level advisory locks (`pg_try_advisory_lock` /
 * `pg_advisory_unlock`) are tied to the DB *session* (connection) that
 * acquired them. The platform runs every plugin query through a
 * schema-scoped proxy that wraps each statement in its own short
 * transaction on a connection borrowed from the shared pool and returned
 * immediately. Acquiring a session lock through that proxy therefore runs
 * the lock on one pooled connection and the unlock on a *different* one —
 * so the unlock no-ops and the lock leaks until the original connection is
 * recycled. This module fixes that two ways:
 *
 *   - {@link AdvisoryLockService.tryAcquire} checks out ONE dedicated
 *     client from the pool, acquires the session lock on it, and returns a
 *     handle that owns that client. `release()` runs the unlock on the SAME
 *     client and then returns it to the pool. Use this for long-held locks
 *     (e.g. an installer election held across a minutes-long `bun install`)
 *     where a long-open transaction would be unacceptable.
 *
 *   - {@link withXactLock} wraps acquire + work + release in a single
 *     transaction using `pg_advisory_xact_lock`, which auto-releases at
 *     COMMIT/ROLLBACK. Use this for SHORT critical sections (e.g. a
 *     find-then-create dedup) where holding a transaction for the duration
 *     is fine and the auto-release removes any chance of a leak.
 *
 * Keys are arbitrary strings hashed to Postgres' 64-bit lock space via
 * `hashtextextended(key, 0)`. Callers SHOULD namespace keys (e.g.
 * `"script-packages.installer"`, `"incident.dedupe:<systemId>"`) since the
 * advisory-lock space is global to the database server, not schema-scoped.
 */
import { sql } from "drizzle-orm";
import type { SafeDatabase } from "./plugin-system";

/**
 * Minimal pool surface this module needs. Modelled on `pg.Pool` /
 * `pg.PoolClient` without importing `pg` directly so the helper stays a
 * pure type-level contract; the backend wires in the real `adminPool`.
 */
export interface AdvisoryLockPoolClient {
  query<T>(
    queryText: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
  /** Return the client to the pool. */
  release(): void;
  /**
   * Subscribe to async client errors. A session-lock client is held for a long
   * time; if its backend dies (admin termination, failover, network drop) `pg`
   * emits `'error'` on the client, and an `'error'` with no listener is
   * re-thrown by the EventEmitter and would crash the pod. We attach a listener
   * so that loss degrades gracefully instead. Modelled on `pg.Client.on`.
   */
  on(event: "error", listener: (err: Error) => void): void;
}

export interface AdvisoryLockPool {
  connect(): Promise<AdvisoryLockPoolClient>;
}

/** A held session-level advisory lock that owns its dedicated client. */
export interface AdvisoryLockHandle {
  /**
   * Release the lock (`pg_advisory_unlock` on the SAME client) and return
   * the client to the pool. Idempotent: a second call is a no-op.
   */
  release(): Promise<void>;
}

export interface AdvisoryLockService {
  /**
   * Try to acquire a session-level advisory lock for `key` on a dedicated
   * pooled client. Returns a handle on success, or `null` if the lock is
   * already held (by this or another process). The handle owns the client
   * until `release()` is called, so callers MUST always release in a
   * `finally`.
   */
  tryAcquire(key: string): Promise<AdvisoryLockHandle | null>;
}

/**
 * Build an {@link AdvisoryLockService} backed by a pool. The backend
 * provides the real admin pool; tests can provide a faithful fake that
 * models per-connection session-lock semantics.
 */
export function createAdvisoryLockService(
  pool: AdvisoryLockPool,
): AdvisoryLockService {
  return {
    async tryAcquire(key) {
      const client = await pool.connect();
      // A held session lock keeps this client checked out (not idle), so the
      // pool's own error handler won't cover it. If this backend is terminated
      // (admin kill / failover) while the lock is held, `pg` emits `'error'`
      // here; without a listener the process crashes. Swallow it - the session
      // lock is auto-released server-side when the backend dies, and a stale
      // `release()` is already a no-op-safe `finally`, so the loss surfaces as
      // the key simply becoming acquirable again.
      client.on("error", () => {});
      let acquired = false;
      try {
        const result = await client.query<{ ok: boolean }>(
          "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS ok",
          [key],
        );
        acquired = Boolean(result.rows[0]?.ok);
      } catch (error) {
        client.release();
        throw error;
      }
      if (!acquired) {
        // Did not get the lock — return the client immediately. (A failed
        // pg_try_advisory_lock acquires nothing, so there is nothing to
        // unlock.)
        client.release();
        return null;
      }

      let released = false;
      return {
        async release() {
          if (released) return;
          released = true;
          try {
            await client.query(
              "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
              [key],
            );
          } finally {
            client.release();
          }
        },
      };
    },
  };
}

/**
 * Run `fn` while holding a transaction-scoped advisory lock for `key`. The
 * lock is acquired with `pg_advisory_xact_lock` (which BLOCKS until granted)
 * inside a transaction and auto-released at COMMIT/ROLLBACK, so there is no
 * unlock to leak. Use only for SHORT critical sections — the lock is held
 * for the whole transaction.
 *
 * Because the scoped DB runs an entire `transaction()` callback on a single
 * dedicated connection, the lock + the work + the implicit release all share
 * one session, which is exactly the affinity session locks require.
 *
 * `fn` receives the transaction handle `tx` and MUST run its
 * read-then-write critical section on it (not on the outer pool). Running
 * the work on the pool would put it on a DIFFERENT connection than the one
 * holding the lock — so two concurrent callers' critical sections could
 * interleave even though both "hold" the lock. Using `tx` keeps the
 * read-check + write atomic with respect to the lock.
 */
export async function withXactLock<
  S extends Record<string, unknown>,
  T,
>({
  db,
  key,
  fn,
}: {
  db: SafeDatabase<S>;
  key: string;
  fn: (tx: Parameters<Parameters<SafeDatabase<S>["transaction"]>[0]>[0]) => Promise<T>;
}): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
    );
    return fn(tx);
  });
}
