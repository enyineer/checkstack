/**
 * Integration test for MaintenanceService.editUpdate / deleteUpdate status
 * re-derivation against a REAL Postgres. The mocked-DB unit tests cannot prove
 * the transactional recompute of `maintenances.status` from the timeline, which
 * is exactly the header/timeline-divergence class this feature prevents.
 *
 * "Current status" = the `statusChange` of the MOST RECENT status-bearing
 * update (message-only updates ignored). Mirrors the incident twin.
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
const SCHEMA = "maintenance_it_updates";

let admin: Pool;
let pool: Pool;
let service: MaintenanceService;

async function insertMaintenance(id: string, status: string): Promise<void> {
  await pool.query(
    `INSERT INTO "${SCHEMA}".maintenances (id, status) VALUES ($1, $2)`,
    [id, status],
  );
}

async function insertUpdate(row: {
  id: string;
  maintenanceId: string;
  statusChange: string | null;
  createdAt: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO "${SCHEMA}".maintenance_updates
       (id, maintenance_id, message, status_change, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [row.id, row.maintenanceId, "msg", row.statusChange, row.createdAt],
  );
}

async function headerStatus(id: string): Promise<string> {
  const res = await pool.query(
    `SELECT status FROM "${SCHEMA}".maintenances WHERE id = $1`,
    [id],
  );
  return res.rows[0]?.status as string;
}

async function updateRow(id: string): Promise<{
  message: string;
  editedAt: Date | null;
  editHistory: Array<{ message: string; createdAt: string; editedAt: string }>;
}> {
  const res = await pool.query(
    `SELECT message, edited_at, edit_history
       FROM "${SCHEMA}".maintenance_updates WHERE id = $1`,
    [id],
  );
  const row = res.rows[0];
  return {
    message: row.message as string,
    editedAt: row.edited_at as Date | null,
    editHistory: row.edit_history as Array<{
      message: string;
      createdAt: string;
      editedAt: string;
    }>,
  };
}

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "MaintenanceService edit/delete status re-derivation (shared Postgres)",
  () => {
    beforeAll(async () => {
      admin = new Pool({ connectionString: PG_URL });
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
      // Minimal DDL: only the columns edit/delete touch. `status` is text (not
      // the enum); `start_at`/`end_at` are not referenced by these paths.
      await admin.query(
        `CREATE TABLE "${SCHEMA}".maintenances (
          id text PRIMARY KEY,
          status text NOT NULL DEFAULT 'scheduled',
          updated_at timestamp NOT NULL DEFAULT now()
        )`,
      );
      await admin.query(
        `CREATE TABLE "${SCHEMA}".maintenance_updates (
          id text PRIMARY KEY,
          maintenance_id text NOT NULL,
          message text NOT NULL,
          status_change text,
          visibility text NOT NULL DEFAULT 'public',
          created_at timestamp NOT NULL DEFAULT now(),
          edited_at timestamp,
          edit_history jsonb NOT NULL DEFAULT '[]'::jsonb,
          created_by text
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
      await pool.query(`TRUNCATE "${SCHEMA}".maintenances`);
      await pool.query(`TRUNCATE "${SCHEMA}".maintenance_updates`);
    });

    it("deleting the LATEST status-bearing update re-derives the header", async () => {
      await insertMaintenance("m", "in_progress");
      await insertUpdate({
        id: "u1",
        maintenanceId: "m",
        statusChange: "scheduled",
        createdAt: "2026-01-01T00:00:00Z",
      });
      await insertUpdate({
        id: "u2",
        maintenanceId: "m",
        statusChange: "in_progress",
        createdAt: "2026-01-01T01:00:00Z",
      });

      expect(await service.deleteUpdate("u2", "m")).toBe("m");
      expect(await headerStatus("m")).toBe("scheduled");
    });

    it("deleting a NON-latest status-bearing update leaves the header", async () => {
      await insertMaintenance("m", "in_progress");
      await insertUpdate({
        id: "u1",
        maintenanceId: "m",
        statusChange: "scheduled",
        createdAt: "2026-01-01T00:00:00Z",
      });
      await insertUpdate({
        id: "u2",
        maintenanceId: "m",
        statusChange: "in_progress",
        createdAt: "2026-01-01T01:00:00Z",
      });

      expect(await service.deleteUpdate("u1", "m")).toBe("m");
      expect(await headerStatus("m")).toBe("in_progress");
    });

    it("deleting a MESSAGE-ONLY update never changes the header", async () => {
      await insertMaintenance("m", "in_progress");
      await insertUpdate({
        id: "u1",
        maintenanceId: "m",
        statusChange: "in_progress",
        createdAt: "2026-01-01T00:00:00Z",
      });
      await insertUpdate({
        id: "u2",
        maintenanceId: "m",
        statusChange: null,
        createdAt: "2026-01-01T01:00:00Z",
      });

      expect(await service.deleteUpdate("u2", "m")).toBe("m");
      expect(await headerStatus("m")).toBe("in_progress");
    });

    it("editing the latest status-bearing update updates the header (message-only latest edge case)", async () => {
      await insertMaintenance("m", "in_progress");
      await insertUpdate({
        id: "u1",
        maintenanceId: "m",
        statusChange: "scheduled",
        createdAt: "2026-01-01T00:00:00Z",
      });
      await insertUpdate({
        id: "u2",
        maintenanceId: "m",
        statusChange: "in_progress",
        createdAt: "2026-01-01T01:00:00Z",
      });
      await insertUpdate({
        id: "u3",
        maintenanceId: "m",
        statusChange: null,
        createdAt: "2026-01-01T02:00:00Z",
      });

      await service.editUpdate({
        id: "u2",
        maintenanceId: "m",
        statusChange: "completed",
      });
      expect(await headerStatus("m")).toBe("completed");
    });

    it("deleting the latest status-bearing update behind a message-only latest row re-derives correctly", async () => {
      await insertMaintenance("m", "in_progress");
      await insertUpdate({
        id: "u1",
        maintenanceId: "m",
        statusChange: "scheduled",
        createdAt: "2026-01-01T00:00:00Z",
      });
      await insertUpdate({
        id: "u2",
        maintenanceId: "m",
        statusChange: "in_progress",
        createdAt: "2026-01-01T01:00:00Z",
      });
      await insertUpdate({
        id: "u3",
        maintenanceId: "m",
        statusChange: null,
        createdAt: "2026-01-01T02:00:00Z",
      });

      expect(await service.deleteUpdate("u2", "m")).toBe("m");
      expect(await headerStatus("m")).toBe("scheduled");
    });

    it("archives the prior version into edit_history and stamps edited_at on a real change", async () => {
      await insertMaintenance("m", "scheduled");
      await insertUpdate({
        id: "u1",
        maintenanceId: "m",
        statusChange: "scheduled",
        createdAt: "2026-01-01T00:00:00Z",
      });

      const before = await updateRow("u1");
      expect(before.editedAt).toBeNull();
      expect(before.editHistory).toEqual([]);

      await service.editUpdate({
        id: "u1",
        maintenanceId: "m",
        message: "corrected wording",
      });

      const after = await updateRow("u1");
      expect(after.message).toBe("corrected wording");
      expect(after.editedAt).not.toBeNull();
      expect(after.editHistory).toHaveLength(1);
      expect(after.editHistory[0].message).toBe("msg");
    });

    it("a no-op edit (unchanged fields) neither archives nor stamps edited_at", async () => {
      await insertMaintenance("m", "scheduled");
      await insertUpdate({
        id: "u1",
        maintenanceId: "m",
        statusChange: "scheduled",
        createdAt: "2026-01-01T00:00:00Z",
      });

      await service.editUpdate({
        id: "u1",
        maintenanceId: "m",
        message: "msg",
        statusChange: "scheduled",
      });

      const after = await updateRow("u1");
      expect(after.editedAt).toBeNull();
      expect(after.editHistory).toEqual([]);
    });

    it("re-timing an update (createdAt) re-derives the header even without a status edit", async () => {
      await insertMaintenance("m", "in_progress");
      await insertUpdate({
        id: "u1",
        maintenanceId: "m",
        statusChange: "scheduled",
        createdAt: "2026-01-01T00:00:00Z",
      });
      await insertUpdate({
        id: "u2",
        maintenanceId: "m",
        statusChange: "in_progress",
        createdAt: "2026-01-01T01:00:00Z",
      });
      expect(await headerStatus("m")).toBe("in_progress");

      // Move u1 AFTER u2 without touching its status; u1 is now the latest
      // status-bearing update, so the header must fall back to its status.
      await service.editUpdate({
        id: "u1",
        maintenanceId: "m",
        createdAt: new Date("2026-01-01T02:00:00Z"),
      });
      expect(await headerStatus("m")).toBe("scheduled");
    });
  },
);
