/**
 * Integration test for MaintenanceService.getMaintenanceWindowsForRange against
 * a REAL Postgres. This is the regression guard for the SLO error-budget
 * maintenance-exclusion fix: the SLO budget is a TRAILING window, so the query
 * must return windows by TIME-RANGE OVERLAP over `[from, to]`, INCLUDE
 * already-completed windows (and scheduled / in_progress), and EXCLUDE only
 * `cancelled` ones. The overlap+status+grouping SQL cannot be exercised by the
 * mocked-DB unit tests, which is exactly why the whole HIGH fix hinged on it
 * being covered here.
 *
 * Gated on CHECKSTACK_IT so it runs in CI (shared compose Postgres) and is
 * skipped in the default `bun test` run, matching the other *.it.test.ts here.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { SafeDatabase } from "@checkstack/backend-api";
import * as schema from "./schema";
import { MaintenanceService } from "./service";

const PG_URL =
  process.env.CHECKSTACK_IT_PG_URL ??
  "postgres://postgres:postgres@localhost:5432/postgres";
const SCHEMA = "maintenance_it_windowsforrange";

// A fixed 29-day budget window used by every case below.
const FROM = new Date("2026-06-01T00:00:00.000Z");
const TO = new Date("2026-06-30T00:00:00.000Z");
const at = (iso: string): Date => new Date(iso);

let admin: Pool;
let pool: Pool;
let service: MaintenanceService;

/**
 * Insert a maintenance and its system memberships. `status` is written as raw
 * text (the WHERE clause only does `<> 'cancelled'`, identical for text/enum),
 * keeping the DDL minimal like the sibling *.it.test.ts.
 */
async function insertMaintenance(row: {
  id: string;
  status: string;
  startAt: Date;
  endAt: Date;
  systemIds: string[];
}): Promise<void> {
  await pool.query(
    `INSERT INTO "${SCHEMA}".maintenances
       (id, title, status, start_at, end_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [row.id, `Maintenance ${row.id}`, row.status, row.startAt, row.endAt],
  );
  for (const systemId of row.systemIds) {
    await pool.query(
      `INSERT INTO "${SCHEMA}".maintenance_systems (maintenance_id, system_id)
       VALUES ($1, $2)`,
      [row.id, systemId],
    );
  }
}

/** Sorted maintenance ids returned for a system (empty array when absent). */
function idsFor(
  result: Record<string, Array<{ id: string }>>,
  systemId: string,
): string[] {
  return (result[systemId] ?? []).map((m) => m.id).toSorted();
}

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "MaintenanceService.getMaintenanceWindowsForRange (shared Postgres)",
  () => {
    beforeAll(async () => {
      admin = new Pool({ connectionString: PG_URL });
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
      // Minimal DDL: only the two tables the query touches. `status` is text
      // (see insertMaintenance) so no enum type is needed.
      await admin.query(
        `CREATE TABLE "${SCHEMA}".maintenances (
          id text PRIMARY KEY,
          title text NOT NULL,
          description text,
          suppress_notifications boolean NOT NULL DEFAULT false,
          status text NOT NULL DEFAULT 'scheduled',
          start_at timestamp NOT NULL,
          end_at timestamp NOT NULL,
          created_at timestamp NOT NULL DEFAULT now(),
          updated_at timestamp NOT NULL DEFAULT now()
        )`,
      );
      await admin.query(
        `CREATE TABLE "${SCHEMA}".maintenance_systems (
          maintenance_id text NOT NULL,
          system_id text NOT NULL,
          PRIMARY KEY (maintenance_id, system_id)
        )`,
      );
      pool = new Pool({
        connectionString: PG_URL,
        options: `-c search_path=${SCHEMA}`,
      });
      const db = drizzle(pool, {
        schema,
      }) as unknown as SafeDatabase<typeof schema>;
      service = new MaintenanceService(db);
    });

    afterAll(async () => {
      await pool?.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.end();
    });

    beforeEach(async () => {
      await pool.query(`TRUNCATE "${SCHEMA}".maintenance_systems`);
      await pool.query(`TRUNCATE "${SCHEMA}".maintenances CASCADE`);
    });

    // ── Status filtering ────────────────────────────────────────────────────
    it("includes completed/scheduled/in_progress overlapping windows and excludes cancelled", async () => {
      const win = { startAt: at("2026-06-10T00:00:00Z"), endAt: at("2026-06-12T00:00:00Z") };
      await insertMaintenance({ id: "m-completed", status: "completed", ...win, systemIds: ["sys-a"] });
      await insertMaintenance({ id: "m-scheduled", status: "scheduled", ...win, systemIds: ["sys-a"] });
      await insertMaintenance({ id: "m-inprogress", status: "in_progress", ...win, systemIds: ["sys-a"] });
      await insertMaintenance({ id: "m-cancelled", status: "cancelled", ...win, systemIds: ["sys-a"] });

      const result = await service.getMaintenanceWindowsForRange({
        systemIds: ["sys-a"],
        from: FROM,
        to: TO,
      });

      // The completed window is the whole point of the fix: it must be returned.
      // The cancelled one must not.
      expect(idsFor(result, "sys-a")).toEqual([
        "m-completed",
        "m-inprogress",
        "m-scheduled",
      ]);
    });

    // ── Overlap boundaries ──────────────────────────────────────────────────
    it("returns windows that overlap the range in any way and excludes those fully outside", async () => {
      await insertMaintenance({ id: "w-inside", status: "completed", startAt: at("2026-06-10T00:00:00Z"), endAt: at("2026-06-12T00:00:00Z"), systemIds: ["sys-a"] });
      await insertMaintenance({ id: "w-straddle-start", status: "completed", startAt: at("2026-05-28T00:00:00Z"), endAt: at("2026-06-03T00:00:00Z"), systemIds: ["sys-a"] });
      await insertMaintenance({ id: "w-straddle-end", status: "completed", startAt: at("2026-06-28T00:00:00Z"), endAt: at("2026-07-03T00:00:00Z"), systemIds: ["sys-a"] });
      await insertMaintenance({ id: "w-spanning", status: "completed", startAt: at("2026-05-20T00:00:00Z"), endAt: at("2026-07-10T00:00:00Z"), systemIds: ["sys-a"] });
      await insertMaintenance({ id: "w-before", status: "completed", startAt: at("2026-05-01T00:00:00Z"), endAt: at("2026-05-20T00:00:00Z"), systemIds: ["sys-a"] });
      await insertMaintenance({ id: "w-after", status: "completed", startAt: at("2026-07-01T00:00:00Z"), endAt: at("2026-07-20T00:00:00Z"), systemIds: ["sys-a"] });

      const result = await service.getMaintenanceWindowsForRange({
        systemIds: ["sys-a"],
        from: FROM,
        to: TO,
      });

      expect(idsFor(result, "sys-a")).toEqual([
        "w-inside",
        "w-spanning",
        "w-straddle-end",
        "w-straddle-start",
      ]);
    });

    it("treats touching and zero-length boundaries as overlapping (inclusive) and excludes strictly-outside points", async () => {
      // endAt === from and startAt === to touch the range at a single instant;
      // the inclusive overlap test (startAt <= to AND endAt >= from) returns
      // them. The downstream interval math clips them to zero, so returning them
      // is harmless and keeps the boundary well defined.
      await insertMaintenance({ id: "b-touch-from", status: "completed", startAt: at("2026-05-20T00:00:00Z"), endAt: FROM, systemIds: ["sys-a"] });
      await insertMaintenance({ id: "b-touch-to", status: "completed", startAt: TO, endAt: at("2026-07-10T00:00:00Z"), systemIds: ["sys-a"] });
      await insertMaintenance({ id: "b-zero-inside", status: "completed", startAt: at("2026-06-15T00:00:00Z"), endAt: at("2026-06-15T00:00:00Z"), systemIds: ["sys-a"] });
      await insertMaintenance({ id: "b-zero-outside", status: "completed", startAt: at("2026-05-15T00:00:00Z"), endAt: at("2026-05-15T00:00:00Z"), systemIds: ["sys-a"] });

      const result = await service.getMaintenanceWindowsForRange({
        systemIds: ["sys-a"],
        from: FROM,
        to: TO,
      });

      expect(idsFor(result, "sys-a")).toEqual([
        "b-touch-from",
        "b-touch-to",
        "b-zero-inside",
      ]);
    });

    // ── Grouping ────────────────────────────────────────────────────────────
    it("groups windows per requested system, keeps full membership, and omits unrequested/empty systems", async () => {
      const win = { startAt: at("2026-06-10T00:00:00Z"), endAt: at("2026-06-12T00:00:00Z"), status: "completed" };
      await insertMaintenance({ id: "m-a", ...win, systemIds: ["sys-a"] });
      await insertMaintenance({ id: "m-ab", ...win, systemIds: ["sys-a", "sys-b"] });
      await insertMaintenance({ id: "m-c", ...win, systemIds: ["sys-c"] });

      // Request sys-a (has windows) and sys-none (has none). sys-c is not
      // requested and must not leak in.
      const result = await service.getMaintenanceWindowsForRange({
        systemIds: ["sys-a", "sys-none"],
        from: FROM,
        to: TO,
      });

      expect(idsFor(result, "sys-a")).toEqual(["m-a", "m-ab"]);
      // A requested system with no overlapping windows is absent from the map.
      expect(result["sys-none"]).toBeUndefined();
      // An unrequested system is never a key.
      expect(result["sys-c"]).toBeUndefined();

      // The multi-system window reports its FULL membership (both a and b),
      // even though only sys-a was requested.
      const mab = result["sys-a"]?.find((m) => m.id === "m-ab");
      expect(mab?.systemIds.toSorted()).toEqual(["sys-a", "sys-b"]);
    });

    it("returns an empty map for empty systemIds input", async () => {
      await insertMaintenance({ id: "m-a", status: "completed", startAt: at("2026-06-10T00:00:00Z"), endAt: at("2026-06-12T00:00:00Z"), systemIds: ["sys-a"] });

      const result = await service.getMaintenanceWindowsForRange({
        systemIds: [],
        from: FROM,
        to: TO,
      });

      expect(result).toEqual({});
    });
  },
);
