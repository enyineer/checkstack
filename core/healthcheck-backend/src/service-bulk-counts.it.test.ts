/**
 * Integration test for `HealthCheckService.getBulkAssignedHealthCheckCounts`
 * against a REAL Postgres. The method's whole point is the GROUP BY / COUNT and
 * the zero-fill for systems with no rows - behaviour a mocked db cannot prove
 * (the database does the grouping). These tests pin: counts are grouped per
 * system, systems with no assignments report 0, requested-but-absent systems
 * report 0, and non-requested systems never leak in.
 *
 * Gated on CHECKSTACK_IT so it runs in CI (shared compose Postgres) and is
 * skipped in the default `bun test` run, matching the other *.it.test.ts here.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type {
  SafeDatabase,
  HealthCheckRegistry,
  CollectorRegistry,
} from "@checkstack/backend-api";
import * as schema from "./schema";
import { HealthCheckService } from "./service";

const PG_URL =
  process.env.CHECKSTACK_IT_PG_URL ??
  "postgres://postgres:postgres@localhost:5432/postgres";
const SCHEMA = "healthcheck_it_bulk_counts";

let admin: Pool;
let pool: Pool;
let service: HealthCheckService;

async function insertAssignment(row: {
  systemId: string;
  configurationId: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO "${SCHEMA}".system_health_checks (system_id, configuration_id)
     VALUES ($1, $2)`,
    [row.systemId, row.configurationId],
  );
}

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "HealthCheckService.getBulkAssignedHealthCheckCounts (shared Postgres)",
  () => {
    beforeAll(async () => {
      admin = new Pool({ connectionString: PG_URL });
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
      // Only the columns the grouped COUNT touches; no FK to configurations so
      // the DDL stays minimal and focused on the aggregation behaviour.
      await admin.query(
        `CREATE TABLE "${SCHEMA}".system_health_checks (
          system_id text NOT NULL,
          configuration_id uuid NOT NULL,
          PRIMARY KEY (system_id, configuration_id)
        )`,
      );
      pool = new Pool({
        connectionString: PG_URL,
        options: `-c search_path=${SCHEMA}`,
      });
      const db = drizzle(pool, {
        schema,
      }) as unknown as SafeDatabase<typeof schema>;
      // registry / collectorRegistry are unused by the count method under test;
      // stub them so the constructor is satisfied without wiring real registries.
      const service_ = new HealthCheckService(
        db,
        {} as unknown as HealthCheckRegistry,
        {} as unknown as CollectorRegistry,
      );
      service = service_;
    });

    afterAll(async () => {
      await pool?.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.end();
    });

    beforeEach(async () => {
      await pool.query(`TRUNCATE "${SCHEMA}".system_health_checks`);
    });

    it("groups counts per system and zero-fills systems with no assignments", async () => {
      // sys-a: 2 assignments, sys-b: 1, sys-c: none.
      await insertAssignment({
        systemId: "sys-a",
        configurationId: crypto.randomUUID(),
      });
      await insertAssignment({
        systemId: "sys-a",
        configurationId: crypto.randomUUID(),
      });
      await insertAssignment({
        systemId: "sys-b",
        configurationId: crypto.randomUUID(),
      });

      const counts = await service.getBulkAssignedHealthCheckCounts([
        "sys-a",
        "sys-b",
        "sys-c",
      ]);

      expect(counts).toEqual({ "sys-a": 2, "sys-b": 1, "sys-c": 0 });
    });

    it("returns 0 for a requested system that has no rows at all", async () => {
      await insertAssignment({
        systemId: "sys-a",
        configurationId: crypto.randomUUID(),
      });

      const counts = await service.getBulkAssignedHealthCheckCounts([
        "sys-a",
        "missing",
      ]);

      expect(counts).toEqual({ "sys-a": 1, missing: 0 });
    });

    it("never leaks counts for systems not in the requested set", async () => {
      await insertAssignment({
        systemId: "sys-a",
        configurationId: crypto.randomUUID(),
      });
      await insertAssignment({
        systemId: "sys-other",
        configurationId: crypto.randomUUID(),
      });

      const counts = await service.getBulkAssignedHealthCheckCounts(["sys-a"]);

      expect(counts).toEqual({ "sys-a": 1 });
      expect(Object.keys(counts)).not.toContain("sys-other");
    });

    it("returns an empty map for an empty request without querying", async () => {
      expect(await service.getBulkAssignedHealthCheckCounts([])).toEqual({});
    });
  },
);
