import { describe, it, expect } from "bun:test";
import type { PoolClient } from "pg";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { runPluginMigrations } from "./run-plugin-migrations";

type MigrationDb = NodePgDatabase<Record<string, unknown>>;

/**
 * A fake pooled client that records the SQL it runs and whether it was
 * released, modelling the bits of `pg.PoolClient` the helper touches.
 */
function makeFakeClient() {
  const queries: string[] = [];
  let released = false;
  const client = {
    query: async (text: string) => {
      queries.push(text);
      return { rows: [] };
    },
    release: () => {
      released = true;
    },
  };
  return {
    client: client as unknown as PoolClient,
    queries,
    isReleased: () => released,
  };
}

describe("runPluginMigrations", () => {
  it("runs the migrator on a single pinned connection with search_path set first", async () => {
    const { client, queries, isReleased } = makeFakeClient();

    let connectCount = 0;
    const pool = {
      connect: async () => {
        connectCount++;
        return client;
      },
    };

    const fakeDb = { __fake: true } as unknown as MigrationDb;
    let dbPassedToMigrate: unknown;
    let clientPassedToFactory: PoolClient | undefined;
    let queriesBeforeMigrate: string[] = [];

    await runPluginMigrations({
      pool,
      migrationsFolder: "/plugins/healthcheck/drizzle",
      migrationsSchema: "plugin_healthcheck",
      createMigrationDb: (c) => {
        clientPassedToFactory = c;
        return fakeDb;
      },
      migrate: async (db, config) => {
        dbPassedToMigrate = db;
        queriesBeforeMigrate = [...queries];
        expect(config.migrationsFolder).toBe("/plugins/healthcheck/drizzle");
        expect(config.migrationsSchema).toBe("plugin_healthcheck");
      },
    });

    // Exactly ONE connection is checked out: the SET and the migration must
    // share a physical connection, which was the whole bug.
    expect(connectCount).toBe(1);

    // The migrator runs against a Drizzle instance bound to that same pinned
    // client.
    expect(clientPassedToFactory).toBe(client);
    expect(dbPassedToMigrate).toBe(fakeDb);

    // search_path is pointed at the plugin schema (after creating it) BEFORE
    // the migrator runs.
    expect(queriesBeforeMigrate).toEqual([
      'CREATE SCHEMA IF NOT EXISTS "plugin_healthcheck"',
      'SET search_path = "plugin_healthcheck"',
    ]);

    // Afterwards the connection is reset and returned to the pool.
    expect(queries.at(-1)).toBe("SET search_path = public");
    expect(isReleased()).toBe(true);
  });

  it("resets search_path and releases the connection even when the migrator throws", async () => {
    const { client, queries, isReleased } = makeFakeClient();
    const pool = { connect: async () => client };
    const boom = new Error("migration failed");

    await expect(
      runPluginMigrations({
        pool,
        migrationsFolder: "/x",
        migrationsSchema: "plugin_x",
        createMigrationDb: () => ({}) as unknown as MigrationDb,
        migrate: async () => {
          throw boom;
        },
      }),
    ).rejects.toThrow("migration failed");

    expect(queries.at(-1)).toBe("SET search_path = public");
    expect(isReleased()).toBe(true);
  });

  it("never touches anything but connect() on the pool (no session SET on the shared pool)", async () => {
    const { client } = makeFakeClient();
    const pool = { connect: async () => client };

    await runPluginMigrations({
      pool,
      migrationsFolder: "/x",
      migrationsSchema: "plugin_x",
      createMigrationDb: () => ({}) as unknown as MigrationDb,
      migrate: async () => {},
    });

    // The pool surface the helper depends on is exactly `connect`; everything
    // else (CREATE SCHEMA, SET search_path, the migration itself) happens on
    // the checked-out client. If this contract ever widens, the regression
    // that motivated the pinned connection could creep back in.
    expect(Object.keys(pool)).toEqual(["connect"]);
  });
});
