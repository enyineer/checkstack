/**
 * Integration test for `HealthCheckService.getBulkRunStats` against a REAL
 * Postgres. The method's whole point is the single grouped read over
 * `health_check_runs` for MANY systems, then per-system summarization - so each
 * entry MUST be byte-identical to what the single `getRunStats({ systemId })`
 * would return for the same window. A mocked db cannot prove the `inArray`
 * grouping / windowing, so this real-DB guard pins the equivalence, the
 * per-system isolation, and the "systems with no runs are omitted" behaviour
 * the status-page uptime column relies on.
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
const SCHEMA = "healthcheck_it_bulk_run_stats";

const START = new Date("2026-06-01T00:00:00.000Z");
const END = new Date("2026-06-01T23:59:59.000Z");

let admin: Pool;
let pool: Pool;
let service: HealthCheckService;

async function insertRun(row: {
  systemId: string;
  status: string;
  latencyMs?: number | null;
  at: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO "${SCHEMA}".health_check_runs
       (id, configuration_id, system_id, status, latency_ms, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      crypto.randomUUID(),
      crypto.randomUUID(),
      row.systemId,
      row.status,
      row.latencyMs ?? null,
      row.at,
    ],
  );
}

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "HealthCheckService.getBulkRunStats (shared Postgres)",
  () => {
    beforeAll(async () => {
      admin = new Pool({ connectionString: PG_URL });
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
      // Minimal DDL: only the columns the grouped read touches; status is plain
      // text and configuration_id carries no FK, keeping the schema
      // self-contained like the sibling *.it.test.ts files.
      await admin.query(
        `CREATE TABLE "${SCHEMA}".health_check_runs (
          id uuid PRIMARY KEY,
          configuration_id uuid NOT NULL,
          system_id text NOT NULL,
          environment_id text,
          status text NOT NULL,
          latency_ms integer,
          result jsonb,
          source_id text,
          source_label text,
          timestamp timestamp NOT NULL DEFAULT now()
        )`,
      );
      pool = new Pool({
        connectionString: PG_URL,
        options: `-c search_path=${SCHEMA}`,
      });
      const db = drizzle(pool, {
        schema,
      }) as unknown as SafeDatabase<typeof schema>;
      // registry / collectorRegistry are unused by the stats read under test;
      // stub them so the constructor is satisfied.
      service = new HealthCheckService(
        db,
        {} as unknown as HealthCheckRegistry,
        {} as unknown as CollectorRegistry,
      );
    });

    afterAll(async () => {
      await pool?.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.end();
    });

    beforeEach(async () => {
      await pool.query(`TRUNCATE "${SCHEMA}".health_check_runs`);
    });

    it("returns per-system stats identical to getRunStats for the same window", async () => {
      // sys-a: 3 healthy + 1 unhealthy; sys-b: 2 healthy; sys-c: no runs.
      await insertRun({ systemId: "sys-a", status: "healthy", latencyMs: 10, at: "2026-06-01T01:00:00Z" });
      await insertRun({ systemId: "sys-a", status: "healthy", latencyMs: 20, at: "2026-06-01T02:00:00Z" });
      await insertRun({ systemId: "sys-a", status: "healthy", latencyMs: 30, at: "2026-06-01T03:00:00Z" });
      await insertRun({ systemId: "sys-a", status: "unhealthy", latencyMs: 40, at: "2026-06-01T04:00:00Z" });
      await insertRun({ systemId: "sys-b", status: "healthy", latencyMs: 5, at: "2026-06-01T05:00:00Z" });
      await insertRun({ systemId: "sys-b", status: "healthy", latencyMs: 7, at: "2026-06-01T06:00:00Z" });
      // A run OUTSIDE the window must be ignored by both endpoints.
      await insertRun({ systemId: "sys-a", status: "unhealthy", at: "2026-05-01T00:00:00Z" });

      const ids = ["sys-a", "sys-b", "sys-c"];
      const stats = await service.getBulkRunStats({
        systemIds: ids,
        startDate: START,
        endDate: END,
        maxBuckets: 24,
      });

      for (const systemId of ids) {
        const single = await service.getRunStats({ systemId, startDate: START, endDate: END, maxBuckets: 24 });
        if (single.total.runCount === 0) {
          // Zero-run systems are omitted from the bulk record.
          expect(stats[systemId]).toBeUndefined();
        } else {
          expect(stats[systemId]).toEqual(single);
        }
      }

      // sys-c had no runs => omitted; only populated systems are keys.
      expect(Object.keys(stats).toSorted()).toEqual(["sys-a", "sys-b"]);
      // Sanity: sys-a uptime = 3/4 healthy = 75%.
      expect(stats["sys-a"]?.total.uptimePct).toBe(75);
    });

    it("returns an empty record for an empty request without querying", async () => {
      expect(
        await service.getBulkRunStats({
          systemIds: [],
          startDate: START,
          endDate: END,
          maxBuckets: 1,
        }),
      ).toEqual({});
    });
  },
);
