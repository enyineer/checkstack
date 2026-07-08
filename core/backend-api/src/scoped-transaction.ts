import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { SafeDatabase } from "./plugin-system";

/**
 * A transaction handle yielded by a scoped database's `.transaction()`.
 *
 * The scoped-db proxy injects `SET LOCAL search_path` ONCE at transaction
 * start, so every query issued on this handle inside the callback runs with
 * the correct plugin schema WITHOUT the per-query transaction the proxy adds
 * to standalone queries. Helpers that run queries on behalf of a caller (and
 * so must accept either the scoped db OR a transaction handle) should type
 * their db parameter as `SafeDatabase<S> | ScopedTransaction<S>`.
 */
export type ScopedTransaction<S extends Record<string, unknown>> =
  PgTransaction<NodePgQueryResultHKT, S, ExtractTablesWithRelations<S>>;

/**
 * A db handle that can run queries under a single already-set search_path:
 * either the scoped database itself or a transaction handle from it. Use this
 * as the parameter type for a helper that must work both when called
 * standalone (pass the scoped db) and when composed inside a batching
 * transaction (pass the `tx`), e.g. `incrementHourlyAggregate`.
 */
export type ScopedQueryRunner<S extends Record<string, unknown>> =
  | SafeDatabase<S>
  | ScopedTransaction<S>;

/**
 * Run several scoped queries under a SINGLE `SET LOCAL search_path` (one
 * transaction) instead of paying the per-query `BEGIN → SET LOCAL → query →
 * COMMIT` cycle the scoped-db proxy adds to EVERY standalone query.
 *
 * ## Why this exists
 *
 * The scoped-db proxy (see `core/backend/src/utils/scoped-db.ts`) has to wrap
 * every standalone query in its own transaction so `SET LOCAL search_path`
 * applies to it — `SET LOCAL` only survives inside a transaction. That is
 * correct but means a hot path issuing N sequential queries pays N× the
 * `BEGIN`/`SET LOCAL`/`COMMIT` round-trips and checks a connection out N
 * times. Wrapping those queries in one explicit transaction collapses that to
 * a single `SET LOCAL` on a single connection held for the batch, cutting
 * connection churn and round-trips.
 *
 * Reach for this on any scoped-db hot path that issues 2+ queries in sequence:
 * a `1 + N` read fan-out (e.g. an aggregate that reads a parent row then one
 * row per child), or a write group (an `insert` followed by an `upsert`).
 * Queries inside the callback run on `tx`, NOT the outer `db`, so pass `tx`
 * down to any helper that runs queries — its parameter should accept
 * `ScopedTransaction<S>` (see {@link ScopedQueryRunner}).
 *
 * @example
 * ```ts
 * const status = await withScopedTransaction(db, async (tx) => {
 *   const parent = await tx.select().from(parents).where(eq(parents.id, id));
 *   const children = await tx.select().from(kids).where(eq(kids.parentId, id));
 *   return derive(parent, children); // 1 SET LOCAL, not 2
 * });
 * ```
 */
export function withScopedTransaction<S extends Record<string, unknown>, R>(
  db: SafeDatabase<S>,
  fn: (tx: ScopedTransaction<S>) => Promise<R>,
): Promise<R> {
  return db.transaction(fn);
}
