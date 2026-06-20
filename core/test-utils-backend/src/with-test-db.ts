import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { SafeDatabase } from "@checkstack/backend-api";

/**
 * A real-Postgres test database, isolated in a throwaway schema, for
 * `*.it.test.ts` query-correctness tests. Use this when the SQL itself is the
 * risk (team-scoping/visibility filters, joins, aggregations) — the
 * `createMockDb()` stub returns canned empty results and cannot verify query
 * shape, so it proves branch logic only, not the SQL.
 *
 * Mirrors `core/e2e/scripts/start-e2e-server.ts` and the existing IT tests'
 * per-run schema isolation: every call creates a uniquely named schema, runs
 * the package's Drizzle migrations into it with a strict `search_path`, hands
 * back a `SafeDatabase` bound to that schema, and tears it all down on
 * `dispose()`.
 */
export interface TestDb<S extends Record<string, unknown>> {
  /** A `SafeDatabase` bound to the isolated schema (relational API omitted). */
  readonly db: SafeDatabase<S>;
  /** The unique, throwaway schema name this database lives in. */
  readonly schema: string;
  /** Drop the schema and close the pool. Always call this in `afterAll`/`afterEach`. */
  dispose(): Promise<void>;
}

export interface WithTestDbOptions<S extends Record<string, unknown>> {
  /**
   * The package's Drizzle schema object (the `* as schema` import). Passed to
   * `drizzle({ schema })` so the returned `db` is fully typed.
   */
  schema: S;
  /**
   * Absolute path to the package's `drizzle/` migrations folder (the one with
   * the `.sql` files + `meta/`). Run the package generator to keep it in sync;
   * never hand-edit applied migrations (see `.claude/rules/migrations.md`).
   */
  migrationsFolder: string;
  /**
   * Postgres connection string. Defaults to `CHECKSTACK_IT_PG_URL`, matching the
   * existing IT lane + the CI `integration` job.
   */
  connectionString?: string;
  /** Override the generated schema name (mostly for deterministic debugging). */
  schemaName?: string;
}

const DEFAULT_PG_URL = "postgres://checkstack:checkstack@localhost:5432/checkstack";

/**
 * True only when the integration lane is enabled. Suites that use
 * {@link withTestDb} MUST wrap themselves in
 * `describe.skipIf(!isIntegrationEnabled())(...)` (or the `CHECKSTACK_IT`
 * env check) so the default `bun test` never tries to reach a real database.
 */
export function isIntegrationEnabled(): boolean {
  return Boolean(process.env.CHECKSTACK_IT);
}

/**
 * Provision an isolated, migration-fresh test database. Throws if the
 * integration lane is not enabled, so a misconfigured suite fails loudly
 * instead of silently hitting a developer's working database.
 */
export async function withTestDb<S extends Record<string, unknown>>(
  options: WithTestDbOptions<S>,
): Promise<TestDb<S>> {
  if (!isIntegrationEnabled()) {
    throw new Error(
      "withTestDb() requires CHECKSTACK_IT=1 and a real Postgres. Wrap the " +
        "suite in describe.skipIf(!isIntegrationEnabled()) so the default " +
        "`bun test` lane never reaches a database.",
    );
  }

  const connectionString =
    options.connectionString ??
    process.env.CHECKSTACK_IT_PG_URL ??
    DEFAULT_PG_URL;

  const schema =
    options.schemaName ??
    `it_${crypto.randomUUID().replaceAll("-", "")}`;

  // A dedicated pool whose every connection resolves the throwaway schema
  // first. Binding via the pool `options` keeps the search_path on every
  // physical connection the pool hands out (a session-level SET on a Pool is
  // not guaranteed to land on the same connection a later query checks out).
  const pool = new Pool({
    connectionString,
    options: `-c search_path=${schema}`,
  });

  // The migrator must run with the schema present and the search_path pinned to
  // a single connection (Drizzle wraps all pending migrations in one
  // transaction), mirroring runPluginMigrations().
  const migrationClient = await pool.connect();
  try {
    await migrationClient.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await migrationClient.query(`SET search_path = "${schema}"`);
    await migrate(drizzle(migrationClient), {
      migrationsFolder: options.migrationsFolder,
      migrationsSchema: schema,
    });
  } finally {
    migrationClient.release();
  }

  // `drizzle()` returns a NodePgDatabase<S>; SafeDatabase<S> is that minus the
  // relational `query` API. The cast strips it at the type level (the same
  // pattern the existing IT tests use); the scoped-db runtime proxy blocks the
  // relational API in production, and tests simply never call it.
  const fullDb: NodePgDatabase<S> = drizzle({ client: pool, schema: options.schema });
  const db = fullDb as unknown as SafeDatabase<S>;

  return {
    db,
    schema,
    dispose: async () => {
      const cleanup = await pool.connect();
      try {
        await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        cleanup.release();
      }
      await pool.end();
    },
  };
}
