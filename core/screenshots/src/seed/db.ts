import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as healthcheckSchema from "@checkstack/healthcheck-backend/src/schema";
import * as sloSchema from "@checkstack/slo-backend/src/schema";
import * as anomalySchema from "@checkstack/anomaly-backend/src/schema";
import * as aiSchema from "@checkstack/ai-backend/src/schema";
import * as notificationSchema from "@checkstack/notification-backend/src/schema";

/**
 * A direct Drizzle handle over the seed database, carrying the union of the
 * healthcheck, SLO, and anomaly table definitions.
 *
 * Historic time-series (runs, aggregates, state transitions, SLO downtime
 * events / snapshots / streaks, anomaly baselines / detections) has no public
 * API - it is normally produced by probes and cron jobs over days. For a
 * populated screenshot instance we insert it straight into the owning plugins'
 * tables, reusing their real Drizzle schemas so column names never drift.
 *
 * The tables carry no cross-plugin foreign keys (systemId / configurationId are
 * bare text/uuid, mirroring the runtime), so a single pooled connection with
 * the merged schema can write all three domains.
 */
export const schema = {
  ...healthcheckSchema,
  ...sloSchema,
  ...anomalySchema,
  ...aiSchema,
  ...notificationSchema,
};

export type SeedDb = ReturnType<typeof createSeedDb>["db"];

/**
 * Every plugin owns a Postgres schema `plugin_<pluginId>` (see
 * `getPluginSchemaName` in `@checkstack/drizzle-helper`); the runtime resolves
 * its unqualified table names through a per-connection `search_path`. Our
 * Drizzle table objects are likewise unqualified, so the seed pool must set the
 * same `search_path` (the three domains we write to have no colliding table
 * names, so listing all three resolves each name to its owning schema).
 */
const SEED_SEARCH_PATH =
  "plugin_healthcheck,plugin_slo,plugin_anomaly,plugin_ai,plugin_notification,public";

export function createSeedDb({ databaseUrl }: { databaseUrl: string }) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 4,
    // Applied at connection startup, before any query runs.
    options: `-c search_path=${SEED_SEARCH_PATH}`,
  });
  const db = drizzle({ client: pool, schema });
  return { db, close: () => pool.end() };
}
