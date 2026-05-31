import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as defaultMigrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool, PoolClient } from "pg";

type MigrationDb = NodePgDatabase<Record<string, unknown>>;

export interface RunPluginMigrationsArgs {
  /** Shared admin pool; the helper checks out ONE dedicated client from it. */
  pool: Pick<Pool, "connect">;
  /** Absolute path to the plugin's Drizzle migrations folder. */
  migrationsFolder: string;
  /**
   * Postgres schema the plugin's objects live in (e.g. `plugin_healthcheck`).
   * Also used by Drizzle for the per-plugin `__drizzle_migrations` table.
   */
  migrationsSchema: string;
  /**
   * Builds the Drizzle instance the migrator runs against. Defaults to one
   * bound to the pinned `client`. Injectable so tests can run without a real
   * connection.
   */
  createMigrationDb?: (client: PoolClient) => MigrationDb;
  /** Drizzle's migrator. Injectable for tests. */
  migrate?: (
    db: MigrationDb,
    config: { migrationsFolder: string; migrationsSchema: string },
  ) => Promise<void>;
}

/**
 * Run a plugin's Drizzle migrations on a SINGLE pinned pool connection.
 *
 * ## Why a pinned connection is required
 *
 * Plugin migrations are schema-agnostic: they reference the plugin's tables,
 * types, and enums *unqualified* and rely on `search_path` to resolve them
 * into the plugin's schema (e.g. `plugin_healthcheck`). So `search_path` must
 * be set before the migration SQL runs.
 *
 * Setting it at the *session* level on the shared pool does NOT work, for the
 * same reason session-level advisory locks don't (see `advisory-lock.ts`):
 * Drizzle's `migrate()` wraps all pending migrations in one transaction, and
 * with a `pg.Pool` that transaction checks out a *different* physical
 * connection than the one the `SET` ran on. The migration statements then
 * execute with the default `public` search_path.
 *
 * This stays invisible on a fresh database - every object (including each
 * enum) is created within that one transaction, so unqualified references
 * still resolve against whatever schema that connection happens to use. But on
 * an UPGRADE, where earlier migrations already created an enum in the plugin
 * schema and only newer migrations run, a new migration that references the
 * pre-existing enum fails with `type "..." does not exist`.
 *
 * Binding the migrator to ONE pinned client, on which we set `search_path`
 * first, guarantees every migration statement runs under the intended schema.
 */
export async function runPluginMigrations({
  pool,
  migrationsFolder,
  migrationsSchema,
  createMigrationDb = (client) => drizzle(client),
  migrate = defaultMigrate,
}: RunPluginMigrationsArgs): Promise<void> {
  const client = await pool.connect();
  try {
    // Ensure the schema exists before pointing search_path at it. SET to a
    // missing schema silently falls back to `public` at resolution time, which
    // would recreate the very bug this helper exists to prevent.
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${migrationsSchema}"`);
    await client.query(`SET search_path = "${migrationsSchema}"`);

    await migrate(createMigrationDb(client), {
      migrationsFolder,
      migrationsSchema,
    });
  } finally {
    // Reset before the client returns to the pool so the setting never leaks
    // onto an unrelated query that later reuses this physical connection.
    try {
      await client.query("SET search_path = public");
    } catch (resetError) {
      // Best-effort: the release below still returns the connection. Reference
      // the binding so lint doesn't flag an empty catch.
      void resetError;
    }
    client.release();
  }
}
