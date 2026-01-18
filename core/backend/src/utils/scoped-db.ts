import { SafeDatabase } from "@checkstack/backend-api";
import { sql, entityKind } from "drizzle-orm";

/**
 * =============================================================================
 * SCOPED DATABASE PROXY
 * =============================================================================
 *
 * This module provides schema-scoped database isolation for plugins without
 * creating separate connection pools. It solves the "Multi-Pool Exhaustion
 * Hazard" by using a single shared connection pool with per-query schema
 * isolation via PostgreSQL's `SET LOCAL search_path`.
 *
 * ## Background: The Problem
 *
 * In a multi-tenant plugin architecture, each plugin needs database isolation
 * to prevent schema collisions. The naive approach is to create a separate
 * connection pool per plugin, but this leads to connection pool exhaustion
 * when many plugins are loaded.
 *
 * ## Solution: Schema-Scoped Proxy
 *
 * Instead of separate pools, we:
 * 1. Use a SINGLE shared connection pool for all plugins
 * 2. Wrap the database instance in a Proxy
 * 3. Inject `SET LOCAL search_path = "plugin_schema", public` before each query
 * 4. The query then runs with the correct schema context
 *
 * ## Critical Implementation Constraint: Transactions Required
 *
 * `SET LOCAL` only persists within the current transaction. In autocommit mode
 * (the default), each SQL statement is its own transaction:
 *
 *   ```
 *   SET LOCAL search_path = "my_schema"  <-- Transaction 1 (commits immediately)
 *   SELECT * FROM users                   <-- Transaction 2 (search_path is reset!)
 *   ```
 *
 * This means SET LOCAL has NO EFFECT on the subsequent query because they're
 * in different transactions.
 *
 * To solve this, we wrap each query execution in an EXPLICIT transaction:
 *
 *   ```
 *   BEGIN
 *     SET LOCAL search_path = "my_schema"  <-- Same transaction
 *     SELECT * FROM users                   <-- search_path is now effective!
 *   COMMIT
 *   ```
 *
 * ## Implementation: Chain Recording & Replay
 *
 * Drizzle's query builders use a synchronous chaining API:
 *   `db.select().from(users).where(eq(users.id, 1))`
 *
 * We can't wrap these methods in async functions (it would break chaining).
 * Instead, we:
 *
 * 1. **Record the chain**: Track which methods are called with which arguments
 * 2. **Intercept execution**: When `.then()` or `.execute()` is called
 * 3. **Replay in transaction**: Start a transaction, set search_path, then
 *    replay the entire chain on the transaction's database instance
 *
 * This ensures:
 * - Synchronous chaining is preserved (no breaking changes to calling code)
 * - search_path is set in the same transaction as the query
 * - All queries are properly isolated to their plugin's schema
 *
 * ## Flow Example
 *
 * ```typescript
 * // Plugin code (unchanged):
 * const users = await db.select().from(schema.users).where(eq(schema.users.id, 1));
 *
 * // What actually happens:
 * // 1. db.select() -> returns wrapped builder, records: { method: "select", args: [] }
 * // 2. .from(schema.users) -> records: chain = [{ method: "from", args: [users] }]
 * // 3. .where(...) -> records: chain = [..., { method: "where", args: [...] }]
 * // 4. await (calls .then()) -> triggers transaction:
 * //    BEGIN
 * //      SET LOCAL search_path = "plugin_xyz", public
 * //      tx.select().from(users).where(...) -- replayed on tx
 * //    COMMIT
 * // 5. Returns query results
 * ```
 *
 * @see /docs/backend/database-architecture.md for more context
 * =============================================================================
 */

/**
 * Drizzle entity kinds that identify query builders requiring schema isolation.
 *
 * Instead of maintaining a list of METHOD NAMES (which changes when Drizzle
 * adds new methods), we identify builders by their ENTITY KIND (which changes
 * only when Drizzle adds entirely new builder types - much rarer).
 *
 * Each Drizzle class has a static `entityKind` symbol that identifies its type.
 * We check if returned objects match these known query builder kinds.
 *
 * WHY NOT wrap all thenables?
 * - The relational query API (db.query.*) returns thenables with entityKind
 *   "PgRelationalQueryBuilder" which has a different internal structure and
 *   would break if wrapped with our chain-replay mechanism.
 * - Other Drizzle utilities may return thenables that aren't query builders.
 *
 * @see https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/entity.ts
 */
const WRAPPABLE_ENTITY_KINDS = new Set([
  // SELECT builders (from select, selectDistinct, selectDistinctOn)
  "PgSelectBuilder",
  // INSERT builder (from insert)
  "PgInsertBuilder",
  // UPDATE builder (from update)
  "PgUpdateBuilder",
  // DELETE builder (from delete) - note: uses PgDelete, not PgDeleteBuilder
  "PgDelete",
  // Materialized view refresh (from refreshMaterializedView)
  "PgRefreshMaterializedView",
]);

/**
 * Checks if a value is a Drizzle query builder that should be wrapped.
 *
 * Uses Drizzle's internal entityKind symbol to identify builder types.
 * This is more robust than checking method names because:
 * - New methods using existing builder types automatically work
 * - Typos in method names don't silently break (they fail visibly)
 * - The relational query API is correctly excluded
 */
function isWrappableBuilder(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;

  // Get the constructor of the object
  const constructor = (value as object).constructor;
  if (!constructor) return false;

  // Check if it has an entityKind and if that kind is wrappable
  if (entityKind in constructor) {
    const kind = (constructor as Record<symbol, unknown>)[entityKind] as string;
    return WRAPPABLE_ENTITY_KINDS.has(kind);
  }

  return false;
}

/**
 * A schema-scoped database type that excludes the relational query API.
 *
 * This type explicitly removes `query` from SafeDatabase so that plugin
 * authors get compile-time errors when trying to use `db.query.*` instead
 * of runtime errors. This provides better DX and catches isolation bypasses
 * at development time.
 *
 * The relational query API is excluded because it uses a different internal
 * execution path that bypasses our schema isolation mechanism.
 */
export type ScopedDatabase<TSchema extends Record<string, unknown>> = Omit<
  SafeDatabase<TSchema>,
  "query"
>;

/**
 * Creates a schema-scoped database proxy without creating a new connection pool.
 *
 * The returned database instance can be used exactly like a normal Drizzle
 * database, but all queries will be automatically scoped to the specified
 * PostgreSQL schema.
 *
 * @param baseDb - The shared database instance (must support transactions)
 * @param schemaName - PostgreSQL schema to scope queries to (e.g., "plugin_auth")
 * @returns A proxied database instance that automatically sets search_path
 *
 * @example
 * ```typescript
 * // Create a scoped database for the auth plugin
 * const authDb = createScopedDb(sharedDb, "plugin_auth");
 *
 * // All queries through authDb will target the plugin_auth schema
 * const users = await authDb.select().from(schema.users);
 * // Executes: BEGIN; SET LOCAL search_path = "plugin_auth", public; SELECT * FROM users; COMMIT;
 * ```
 */
export function createScopedDb<TSchema extends Record<string, unknown>>(
  baseDb: SafeDatabase<Record<string, unknown>>,
  schemaName: string,
): ScopedDatabase<TSchema> {
  const wrappedDb = baseDb as SafeDatabase<TSchema>;

  /**
   * WeakMap to track query chains for each builder instance.
   *
   * Key: The builder object (e.g., the object returned by db.select())
   * Value: The chain info including:
   *   - method: The initial builder method ("select", "insert", etc.)
   *   - args: Arguments passed to the initial method
   *   - chain: Array of subsequent method calls (from, where, orderBy, etc.)
   *
   * Using WeakMap ensures we don't leak memory - when the builder is GC'd,
   * its chain info is automatically cleaned up.
   */
  const pendingChains = new WeakMap<
    object,
    {
      method: string;
      args: unknown[];
      chain: Array<{ method: string; args: unknown[] }>;
    }
  >();

  /**
   * Wraps a query builder to track method calls and execute within a transaction.
   *
   * This function creates a Proxy around the builder that:
   * 1. Records each chained method call (from, where, orderBy, limit, etc.)
   * 2. Intercepts terminal methods (.then(), .execute()) to trigger execution
   * 3. When executed, replays the chain inside a transaction with search_path set
   *
   * @param builder - The original Drizzle query builder
   * @param initialMethod - The method that created this builder ("select", etc.)
   * @param initialArgs - Arguments passed to the initial method
   * @param chain - Accumulated chain of method calls so far
   */
  function wrapBuilder<T extends object>(
    builder: T,
    initialMethod: string,
    initialArgs: unknown[],
    chain: Array<{ method: string; args: unknown[] }> = [],
  ): T {
    // Store chain info for this builder instance
    pendingChains.set(builder, {
      method: initialMethod,
      args: initialArgs,
      chain,
    });

    return new Proxy(builder, {
      get(builderTarget, prop, receiver) {
        const value = Reflect.get(builderTarget, prop, receiver);

        /**
         * Intercept .then() - this is called when the query is awaited.
         *
         * JavaScript's await calls .then() on thenable objects. Drizzle query
         * builders are thenables, so this is where execution happens.
         *
         * When .then() is called, we:
         * 1. Start a transaction on the base database
         * 2. Set the search_path inside the transaction
         * 3. Replay the entire query chain on the transaction's db instance
         * 4. Return the results through the promise chain
         */
        if (prop === "then" && typeof value === "function") {
          return (
            onFulfilled?: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => {
            const chainInfo = pendingChains.get(builder);
            if (!chainInfo) {
              // Fallback: no chain info means this wasn't created by our proxy
              // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
              return (value as Function).call(
                builderTarget,
                onFulfilled,
                onRejected,
              );
            }

            // Execute the query inside a transaction with search_path set
            const promise = baseDb.transaction(async (tx) => {
              // Set the schema search_path for this transaction
              // SET LOCAL ensures it only affects this transaction
              await tx.execute(
                sql.raw(`SET LOCAL search_path = "${schemaName}", public`),
              );

              // Rebuild the query on the transaction connection
              // We call the same method (select/insert/etc.) on tx instead of target
              type TxMethod = (...args: unknown[]) => unknown;
              let txQuery = (
                tx[chainInfo.method as keyof typeof tx] as TxMethod
              )(...chainInfo.args);

              // Replay all the chained method calls (from, where, orderBy, etc.)
              for (const call of chainInfo.chain) {
                txQuery = (txQuery as Record<string, TxMethod>)[call.method](
                  ...call.args,
                );
              }

              // Execute the query and return results
              // Must await because txQuery is a thenable builder
              return await txQuery;
            });

            // Chain the user's handlers onto our promise
            return promise.then(onFulfilled, onRejected);
          };
        }

        /**
         * Intercept .execute() - explicit execution method.
         *
         * Some Drizzle operations use .execute() instead of being awaited.
         * We handle this the same way as .then().
         */
        if (prop === "execute" && typeof value === "function") {
          return async (...args: unknown[]) => {
            const chainInfo = pendingChains.get(builder);
            if (!chainInfo) {
              return (value as (...a: unknown[]) => Promise<unknown>).apply(
                builderTarget,
                args,
              );
            }

            return baseDb.transaction(async (tx) => {
              await tx.execute(
                sql.raw(`SET LOCAL search_path = "${schemaName}", public`),
              );

              type TxMethod = (...args: unknown[]) => unknown;
              let txQuery = (
                tx[chainInfo.method as keyof typeof tx] as TxMethod
              )(...chainInfo.args);

              for (const call of chainInfo.chain) {
                txQuery = (txQuery as Record<string, TxMethod>)[call.method](
                  ...call.args,
                );
              }

              // Call .execute() on the rebuilt query with original args
              return (
                txQuery as { execute: (...a: unknown[]) => Promise<unknown> }
              ).execute(...args);
            });
          };
        }

        /**
         * Intercept chained methods (from, where, orderBy, limit, etc.)
         *
         * These are NOT terminal - they return new builder objects that
         * continue the chain. We:
         * 1. Call the original method
         * 2. Record the call in our chain
         * 3. Wrap the returned builder with our proxy
         */
        if (typeof value === "function") {
          return (...args: unknown[]) => {
            // Call the original method
            const result = (value as (...a: unknown[]) => unknown).apply(
              builderTarget,
              args,
            );

            // If it returns an object (likely another builder), wrap it
            if (result && typeof result === "object") {
              const chainInfo = pendingChains.get(builder);
              // Extend the chain with this method call
              const newChain = chainInfo
                ? [...chainInfo.chain, { method: String(prop), args }]
                : [{ method: String(prop), args }];

              return wrapBuilder(
                result as object,
                chainInfo?.method || initialMethod,
                chainInfo?.args || initialArgs,
                newChain,
              );
            }
            return result;
          };
        }

        return value;
      },
    });
  }

  /**
   * Main proxy that wraps the database instance.
   *
   * This intercepts:
   * - transaction(): Wraps user's transaction callback to set search_path once
   * - execute(): Wraps raw SQL execution in a transaction
   * - Builder methods: Returns wrapped builders that track the chain
   */
  return new Proxy(wrappedDb, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      /**
       * BLOCK the relational query API (db.query.*).
       *
       * The relational query API uses a different internal execution path
       * that bypasses our chain-replay mechanism. If we allowed it, queries
       * would run WITHOUT the search_path being set, potentially accessing
       * data in other schemas.
       *
       * Plugins MUST use the standard query builder API instead:
       * - db.select().from(table) instead of db.query.table.findMany()
       * - db.select().from(table).limit(1) instead of db.query.table.findFirst()
       */
      if (prop === "query") {
        throw new Error(
          `[Schema Isolation] The relational query API (db.query.*) is not ` +
            `supported in schema-scoped databases because it bypasses schema ` +
            `isolation. Use the standard query builder API instead:\n` +
            `  - db.select().from(table) instead of db.query.table.findMany()\n` +
            `  - db.select().from(table).where(...).limit(1) instead of db.query.table.findFirst()\n` +
            `Current schema: "${schemaName}"`,
        );
      }

      /**
       * Handle explicit transactions.
       *
       * When the user calls db.transaction(), we wrap it to automatically
       * set the search_path at the start of the transaction. This way,
       * all queries within the transaction use the correct schema without
       * needing the chain-replay mechanism.
       */
      if (prop === "transaction") {
        return async <T>(
          callback: (tx: ScopedDatabase<TSchema>) => Promise<T>,
        ): Promise<T> => {
          return target.transaction(async (tx) => {
            // Set search_path once at transaction start
            await tx.execute(
              sql.raw(`SET LOCAL search_path = "${schemaName}", public`),
            );
            // User's callback runs with the correct schema
            return callback(tx as ScopedDatabase<TSchema>);
          });
        };
      }

      /**
       * Handle direct db.execute() calls for raw SQL.
       *
       * Raw SQL also needs the search_path set, so we wrap it in a transaction.
       */
      if (prop === "execute" && typeof value === "function") {
        return async (...args: unknown[]) => {
          return target.transaction(async (tx) => {
            await tx.execute(
              sql.raw(`SET LOCAL search_path = "${schemaName}", public`),
            );
            return (tx.execute as (...a: unknown[]) => Promise<unknown>).apply(
              tx,
              args,
            );
          });
        };
      }

      /**
       * Handle db.$count() calls.
       *
       * The $count utility is a newer Drizzle method that returns a Promise
       * directly (not a query builder), so it's not caught by the entityKind
       * detection for query builders. We need to explicitly wrap it in a
       * transaction with the search_path set.
       */
      if (prop === "$count" && typeof value === "function") {
        return async (...args: unknown[]) => {
          return target.transaction(async (tx) => {
            await tx.execute(
              sql.raw(`SET LOCAL search_path = "${schemaName}", public`),
            );
            return (tx.$count as (...a: unknown[]) => Promise<unknown>).apply(
              tx,
              args,
            );
          });
        };
      }

      /**
       * Dynamic detection of query builder methods.
       *
       * Instead of hardcoding method names, we:
       * 1. Call any function property
       * 2. Check if the returned object is a Drizzle query builder (via entityKind)
       * 3. If so, wrap it with our chain-tracking proxy
       *
       * This automatically handles new Drizzle methods that use existing builders.
       */
      if (typeof value === "function" && typeof prop === "string") {
        return (...args: unknown[]) => {
          const result = (value as (...a: unknown[]) => unknown).apply(
            target,
            args,
          );

          // Check if the result is a query builder that needs wrapping
          if (isWrappableBuilder(result)) {
            return wrapBuilder(result as object, prop, args);
          }

          return result;
        };
      }

      // Pass through all other properties unchanged
      return value;
    },
  });
}
