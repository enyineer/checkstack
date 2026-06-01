import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema";
import { rootLogger } from "./logger";

// Basic connection string sometimes fails with Bun + pg + docker SASL
// parsing manually or relying on pg to pick up ENV variables if we don't pass anything
// But we passed connectionString.

// Explicitly parse config or fallback to individual env vars to avoid SASL string errors
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not defined");
}

/** Parse a positive-integer env var, falling back to `fallback` when unset/invalid. */
function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * ## Connection budget (read this before bumping the defaults)
 *
 * The platform runs as N horizontally-scaled pods sharing ONE Postgres. The
 * server-wide ceiling is `max_connections`, so the real budget is:
 *
 *   N_pods * (adminPool.max + lockPool.max) <= max_connections - headroom
 *
 * Size the pools off that budget (via the env vars below), NOT off the number
 * of plugins: connections are never pinned per-plugin. The scoped-db proxy sets
 * `SET LOCAL search_path` per transaction on a borrowed-then-returned
 * connection, so a connection is occupied only for one transaction (or one
 * held advisory lock), never for a plugin's lifetime.
 *
 * ## Why two pools
 *
 * Session/transaction advisory locks (see `advisory-lock.ts`) HOLD a connection
 * for the lock's whole lifetime while the locked work runs on a *different*
 * connection. If both came from one pool, then under concurrency >= pool size
 * every slot becomes a lock-holding connection waiting for a work connection
 * that can never free up - a self-inflicted deadlock (observed: 10 connections
 * all `idle in transaction` on `pg_advisory_xact_lock`). Giving advisory locks
 * their own `lockPool` makes the acquire graph acyclic (lockPool -> adminPool,
 * never back), so that deadlock class is impossible.
 *
 * `connectionTimeoutMillis` is the universal safety net: a pg Pool defaults to
 * waiting FOREVER for a free connection, which turns any future exhaustion into
 * a permanent hang (and an upstream 502). With a finite timeout, an exhausted
 * acquire throws, its holder unwinds and releases, and the pool self-heals.
 */
const COMMON_POOL_CONFIG = {
  connectionString,
  connectionTimeoutMillis: intFromEnv(
    "DATABASE_POOL_CONNECTION_TIMEOUT_MS",
    10_000,
  ),
  idleTimeoutMillis: intFromEnv("DATABASE_POOL_IDLE_TIMEOUT_MS", 30_000),
} satisfies PoolConfig;

/**
 * The main pool: serves every plugin query and all API request work. Never used
 * to hold an advisory lock open (that is `lockPool`'s job).
 */
export const adminPool = new Pool({
  ...COMMON_POOL_CONFIG,
  max: intFromEnv("DATABASE_POOL_MAX", 20),
});

/**
 * Dedicated pool for advisory locks ONLY (the session-lock service and
 * `withXactLock`). Kept separate from `adminPool` so a held lock connection
 * and the work it gates draw from different pools - see the deadlock note
 * above. Sized for peak concurrent held locks INCLUDING nesting: one logical
 * operation can hold up to two locks at once (an automation run lock wrapping
 * an `incident.dedupe-open-for-system` lock), so this needs headroom above the
 * raw concurrent-operation count.
 *
 * ## Stall backstops (server-enforced, can't be skipped by a hung process)
 *
 * Advisory locks lock no rows or tables - only other callers of the SAME key
 * block. But a critical section whose `fn` hangs (e.g. an unbounded await)
 * would hold its key + this connection open indefinitely, blocking same-key
 * callers. Two connection-level timeouts bound that, set ONLY on this pool
 * (where every transaction is a short lock critical section, so the limits are
 * safe; the admin pool runs arbitrary plugin work and must NOT inherit them):
 *
 *   - `idle_in_transaction_session_timeout`: the lock transaction sits "idle in
 *     transaction" for the whole time `fn` runs (it only issued BEGIN + the
 *     lock). If `fn` hangs past this, Postgres ABORTS the session, which
 *     auto-releases the advisory lock and frees the connection - so a stall
 *     self-heals instead of stranding the lock forever.
 *   - `lock_timeout`: a caller BLOCKED waiting to acquire a contended/stalled
 *     key aborts after this (verified to apply to `pg_advisory_xact_lock`),
 *     surfacing as a retryable error rather than an indefinite block that also
 *     ties up a lock-pool connection.
 *
 * Both default high enough that a healthy short critical section never trips
 * them; tune via env if your critical sections are unusually long.
 */
export const lockPool = new Pool({
  ...COMMON_POOL_CONFIG,
  max: intFromEnv("DATABASE_LOCK_POOL_MAX", 10),
  idle_in_transaction_session_timeout: intFromEnv(
    "DATABASE_LOCK_IDLE_TX_TIMEOUT_MS",
    30_000,
  ),
  lock_timeout: intFromEnv("DATABASE_LOCK_TIMEOUT_MS", 30_000),
});

// A pg Pool emits 'error' on behalf of IDLE clients whose backend dies (admin
// termination, failover, network drop). With no listener, that 'error' is
// unhandled and CRASHES the process. Log and swallow: the pool discards the
// dead client and hands out a fresh one on the next checkout. (Checked-out
// clients are covered separately - the scoped-db transaction wrapper and the
// advisory-lock service attach their own per-client handlers while held.)
adminPool.on("error", (error) => {
  rootLogger.warn("adminPool idle client error (recovered)", error);
});
lockPool.on("error", (error) => {
  rootLogger.warn("lockPool idle client error (recovered)", error);
});

export const db = drizzle({ client: adminPool, schema });
