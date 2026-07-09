/**
 * Integration test for IncidentService.editUpdate / deleteUpdate status
 * re-derivation against a REAL Postgres. The mocked-DB unit tests cannot prove
 * the transactional recompute of `incidents.status` from the timeline, which is
 * exactly the header/timeline-divergence class this feature exists to prevent.
 *
 * "Current status" = the `statusChange` of the MOST RECENT status-bearing
 * update (message-only updates ignored). These tests prove:
 *  - deleting the latest status-bearing update re-derives the header to the
 *    prior status-bearing update;
 *  - deleting a non-latest status-bearing update, or a message-only update,
 *    does NOT change the header;
 *  - editing the statusChange of the latest status-bearing update updates the
 *    header, even when the latest ROW is a message-only update (the
 *    message-only-latest edge case).
 *
 * Gated on CHECKSTACK_IT so it runs in CI (shared compose Postgres) and is
 * skipped in the default `bun test` run, matching the other *.it.test.ts here.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type {
  AdvisoryLockService,
  SafeDatabase,
} from "@checkstack/backend-api";
import * as schema from "./schema";
import { IncidentService } from "./service";

const PG_URL =
  process.env.CHECKSTACK_IT_PG_URL ??
  "postgres://postgres:postgres@localhost:5432/postgres";
const SCHEMA = "incident_it_updates";

const noopAdvisoryLock: AdvisoryLockService = {
  tryAcquire: async () => null,
  withXactLock: async ({ fn }) => fn(),
};

let admin: Pool;
let pool: Pool;
let service: IncidentService;

async function insertIncident(id: string, status: string): Promise<void> {
  await pool.query(
    `INSERT INTO "${SCHEMA}".incidents (id, status) VALUES ($1, $2)`,
    [id, status],
  );
}

async function insertUpdate(row: {
  id: string;
  incidentId: string;
  statusChange: string | null;
  createdAt: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO "${SCHEMA}".incident_updates
       (id, incident_id, message, status_change, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [row.id, row.incidentId, "msg", row.statusChange, row.createdAt],
  );
}

async function headerStatus(id: string): Promise<string> {
  const res = await pool.query(
    `SELECT status FROM "${SCHEMA}".incidents WHERE id = $1`,
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
       FROM "${SCHEMA}".incident_updates WHERE id = $1`,
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
  "IncidentService edit/delete status re-derivation (shared Postgres)",
  () => {
    beforeAll(async () => {
      admin = new Pool({ connectionString: PG_URL });
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
      // Minimal DDL: only the columns edit/delete touch. `status` is text (not
      // the enum) so the test schema stays self-contained; the service issues
      // partial updates that reference only these columns.
      await admin.query(
        `CREATE TABLE "${SCHEMA}".incidents (
          id text PRIMARY KEY,
          status text NOT NULL DEFAULT 'investigating',
          updated_at timestamp NOT NULL DEFAULT now()
        )`,
      );
      await admin.query(
        `CREATE TABLE "${SCHEMA}".incident_updates (
          id text PRIMARY KEY,
          incident_id text NOT NULL,
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
      service = new IncidentService(db, noopAdvisoryLock);
    });

    afterAll(async () => {
      await pool?.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.end();
    });

    beforeEach(async () => {
      await pool.query(`TRUNCATE "${SCHEMA}".incidents`);
      await pool.query(`TRUNCATE "${SCHEMA}".incident_updates`);
    });

    it("deleting the LATEST status-bearing update re-derives the header", async () => {
      await insertIncident("inc", "identified");
      await insertUpdate({
        id: "u1",
        incidentId: "inc",
        statusChange: "investigating",
        createdAt: "2026-01-01T00:00:00Z",
      });
      await insertUpdate({
        id: "u2",
        incidentId: "inc",
        statusChange: "identified",
        createdAt: "2026-01-01T01:00:00Z",
      });

      expect(await service.deleteUpdate("u2", "inc")).toBe("inc");
      // Header falls back to the remaining status-bearing update (u1).
      expect(await headerStatus("inc")).toBe("investigating");
    });

    it("deleting a NON-latest status-bearing update leaves the header", async () => {
      await insertIncident("inc", "identified");
      await insertUpdate({
        id: "u1",
        incidentId: "inc",
        statusChange: "investigating",
        createdAt: "2026-01-01T00:00:00Z",
      });
      await insertUpdate({
        id: "u2",
        incidentId: "inc",
        statusChange: "identified",
        createdAt: "2026-01-01T01:00:00Z",
      });

      // Delete the OLDER status-bearing update; the newest status (u2) still
      // defines the header.
      expect(await service.deleteUpdate("u1", "inc")).toBe("inc");
      expect(await headerStatus("inc")).toBe("identified");
    });

    it("deleting a MESSAGE-ONLY update never changes the header", async () => {
      await insertIncident("inc", "identified");
      await insertUpdate({
        id: "u1",
        incidentId: "inc",
        statusChange: "identified",
        createdAt: "2026-01-01T00:00:00Z",
      });
      await insertUpdate({
        id: "u2",
        incidentId: "inc",
        statusChange: null,
        createdAt: "2026-01-01T01:00:00Z",
      });

      expect(await service.deleteUpdate("u2", "inc")).toBe("inc");
      expect(await headerStatus("inc")).toBe("identified");
    });

    it("editing the latest status-bearing update updates the header (message-only latest edge case)", async () => {
      await insertIncident("inc", "identified");
      await insertUpdate({
        id: "u1",
        incidentId: "inc",
        statusChange: "investigating",
        createdAt: "2026-01-01T00:00:00Z",
      });
      await insertUpdate({
        id: "u2",
        incidentId: "inc",
        statusChange: "identified",
        createdAt: "2026-01-01T01:00:00Z",
      });
      // The LATEST ROW is message-only, so a "latest row" heuristic would edit
      // the wrong record; the header must follow the latest STATUS-BEARING one.
      await insertUpdate({
        id: "u3",
        incidentId: "inc",
        statusChange: null,
        createdAt: "2026-01-01T02:00:00Z",
      });

      await service.editUpdate({
        id: "u2",
        incidentId: "inc",
        statusChange: "fixing",
      });
      expect(await headerStatus("inc")).toBe("fixing");
    });

    it("deleting the latest status-bearing update behind a message-only latest row re-derives correctly", async () => {
      await insertIncident("inc", "identified");
      await insertUpdate({
        id: "u1",
        incidentId: "inc",
        statusChange: "investigating",
        createdAt: "2026-01-01T00:00:00Z",
      });
      await insertUpdate({
        id: "u2",
        incidentId: "inc",
        statusChange: "identified",
        createdAt: "2026-01-01T01:00:00Z",
      });
      await insertUpdate({
        id: "u3",
        incidentId: "inc",
        statusChange: null,
        createdAt: "2026-01-01T02:00:00Z",
      });

      // Delete the latest status-bearing update (u2); the header must fall back
      // to u1's status even though a newer (message-only) row remains.
      expect(await service.deleteUpdate("u2", "inc")).toBe("inc");
      expect(await headerStatus("inc")).toBe("investigating");
    });

    it("archives the prior version into edit_history and stamps edited_at on a real change", async () => {
      await insertIncident("inc", "investigating");
      await insertUpdate({
        id: "u1",
        incidentId: "inc",
        statusChange: "investigating",
        createdAt: "2026-01-01T00:00:00Z",
      });

      const before = await updateRow("u1");
      expect(before.editedAt).toBeNull();
      expect(before.editHistory).toEqual([]);

      await service.editUpdate({
        id: "u1",
        incidentId: "inc",
        message: "corrected wording",
      });

      const after = await updateRow("u1");
      expect(after.message).toBe("corrected wording");
      expect(after.editedAt).not.toBeNull();
      // The pre-edit message ("msg") is archived as the first snapshot.
      expect(after.editHistory).toHaveLength(1);
      expect(after.editHistory[0].message).toBe("msg");
    });

    it("a no-op edit (unchanged fields) neither archives nor stamps edited_at", async () => {
      await insertIncident("inc", "investigating");
      await insertUpdate({
        id: "u1",
        incidentId: "inc",
        statusChange: "investigating",
        createdAt: "2026-01-01T00:00:00Z",
      });

      // Re-send the SAME message + status; nothing actually changes.
      await service.editUpdate({
        id: "u1",
        incidentId: "inc",
        message: "msg",
        statusChange: "investigating",
      });

      const after = await updateRow("u1");
      expect(after.editedAt).toBeNull();
      expect(after.editHistory).toEqual([]);
    });

    it("re-timing an update (createdAt) re-derives the header even without a status edit", async () => {
      await insertIncident("inc", "identified");
      await insertUpdate({
        id: "u1",
        incidentId: "inc",
        statusChange: "investigating",
        createdAt: "2026-01-01T00:00:00Z",
      });
      await insertUpdate({
        id: "u2",
        incidentId: "inc",
        statusChange: "identified",
        createdAt: "2026-01-01T01:00:00Z",
      });
      // Header currently follows u2 (the latest status-bearing update).
      expect(await headerStatus("inc")).toBe("identified");

      // Move u1 AFTER u2 without touching its status; u1 is now the latest
      // status-bearing update, so the header must fall back to its status.
      await service.editUpdate({
        id: "u1",
        incidentId: "inc",
        createdAt: new Date("2026-01-01T02:00:00Z"),
      });
      expect(await headerStatus("inc")).toBe("investigating");
    });
  },
);
