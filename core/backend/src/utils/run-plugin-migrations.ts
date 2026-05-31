import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as defaultMigrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool, PoolClient } from "pg";
import {
  readPluginOwnedObjects,
  relocateLegacyPublicObjects,
} from "./relocate-legacy-public-objects";

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
  /**
   * Moves the plugin's objects that earlier deploys left in `public` into the
   * plugin schema, before migrations run. Injectable for tests.
   */
  relocateLegacyObjects?: (args: {
    client: PoolClient;
    schema: string;
    migrationsFolder: string;
  }) => Promise<void>;
}

const defaultRelocateLegacyObjects = async ({
  client,
  schema,
  migrationsFolder,
}: {
  client: PoolClient;
  schema: string;
  migrationsFolder: string;
}): Promise<void> => {
  const owned = readPluginOwnedObjects(migrationsFolder);
  await relocateLegacyPublicObjects({ client, schema, owned });
};

/**
 * Run a plugin's Drizzle migrations on a SINGLE pinned pool connection.
 *
 * ## Strict, isolated search_path
 *
 * Plugin migrations are schema-agnostic: they reference the plugin's tables,
 * types, and enums *unqualified* and rely on `search_path` to resolve them. We
 * run them with a STRICT `search_path = "<plugin_schema>"` (no `public`
 * fallback) so new objects can only ever land in the plugin schema, and a
 * migration that references something not in that schema fails loudly instead
 * of silently reading or writing `public`.
 *
 * The schema is created BEFORE the `SET`. That ordering matters: if the schema
 * did not exist, an unqualified `CREATE TABLE` would have nowhere to go and
 * Postgres would error - which is the safe outcome we want, not a silent
 * fallthrough.
 *
 * ## Relocating legacy `public` objects first
 *
 * Some installs created the plugin's objects in `public` (pre-isolation
 * deploys), which is exactly what a strict search_path would choke on. Before
 * migrating, {@link relocateLegacyPublicObjects} moves any of the plugin's
 * objects that are still in `public` into the plugin schema using
 * fully-qualified `ALTER ... SET SCHEMA` (so it needs no search_path of its
 * own). After it runs, everything the plugin owns lives in the plugin schema
 * and the strict search_path resolves cleanly. It is idempotent, so fresh and
 * already-migrated installs are no-ops.
 *
 * ## Why a pinned connection
 *
 * The `search_path` must be set on the exact connection the migration
 * statements run on. Setting it at the *session* level on the shared pool does
 * NOT guarantee that, for the same reason session-level advisory locks don't
 * (see `advisory-lock.ts`): Drizzle's `migrate()` wraps all pending migrations
 * in one transaction, and with a `pg.Pool` that transaction can check out a
 * *different* physical connection than the one the `SET` ran on. Binding the
 * migrator (and the relocation) to ONE pinned client guarantees every statement
 * runs on the connection we prepared.
 */
export async function runPluginMigrations({
  pool,
  migrationsFolder,
  migrationsSchema,
  createMigrationDb = (client) => drizzle(client),
  migrate = defaultMigrate,
  relocateLegacyObjects = defaultRelocateLegacyObjects,
}: RunPluginMigrationsArgs): Promise<void> {
  const client = await pool.connect();
  try {
    // Create the schema BEFORE anything points at it, so relocated and newly
    // created objects have a home and never fall through to `public`.
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${migrationsSchema}"`);

    // Move any of this plugin's objects that earlier deploys left in `public`
    // into the plugin schema, so the strict search_path below resolves them.
    await relocateLegacyObjects({
      client,
      schema: migrationsSchema,
      migrationsFolder,
    });

    // Strict search_path: plugin schema only, no `public` fallback.
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
