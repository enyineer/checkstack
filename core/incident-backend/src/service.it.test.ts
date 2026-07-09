/**
 * Integration test for IncidentService.removeLink against a REAL Postgres,
 * exercising the anti-spoof WHERE clause (`WHERE id AND incidentId`) that the
 * mocked-DB unit tests cannot. removeLink is authorized with `idParam:
 * "incidentId"`, so the caller proves a grant on the PARENT incident. The
 * service MUST additionally scope the delete by that incidentId, or a caller
 * could pair a link id belonging to incident A with an incident B they manage
 * and delete A's link (an IDOR). These tests prove the scoping holds at the SQL
 * layer: a mismatched incidentId removes nothing and returns undefined; only a
 * matched pair deletes.
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
const SCHEMA = "incident_it_removelink";

// removeLink never touches the advisory lock, so a no-op faithful stub is all
// the constructor needs (no cast).
const noopAdvisoryLock: AdvisoryLockService = {
  tryAcquire: async () => null,
  withXactLock: async ({ fn }) => fn(),
};

let admin: Pool;
let pool: Pool;
let service: IncidentService;

async function insertLink(row: {
  id: string;
  incidentId: string;
  url: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO "${SCHEMA}".incident_links (id, incident_id, url)
     VALUES ($1, $2, $3)`,
    [row.id, row.incidentId, row.url],
  );
}

async function linkExists(id: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM "${SCHEMA}".incident_links WHERE id = $1`,
    [id],
  );
  return res.rowCount === 1;
}

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "IncidentService.removeLink anti-spoof scoping (shared Postgres)",
  () => {
    beforeAll(async () => {
      admin = new Pool({ connectionString: PG_URL });
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
      // Only the incident_links table is exercised; no FK to incidents so the
      // DDL stays minimal and focused on the WHERE-clause behavior.
      await admin.query(
        `CREATE TABLE "${SCHEMA}".incident_links (
          id text PRIMARY KEY,
          incident_id text NOT NULL,
          label text,
          url text NOT NULL,
          visibility text NOT NULL DEFAULT 'public',
          created_at timestamp NOT NULL DEFAULT now()
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
      await pool.query(`TRUNCATE "${SCHEMA}".incident_links`);
    });

    it("removes the link and returns the incidentId when the pair matches", async () => {
      await insertLink({ id: "lnk-1", incidentId: "inc-1", url: "https://a" });

      expect(await service.removeLink("lnk-1", "inc-1")).toBe("inc-1");
      expect(await linkExists("lnk-1")).toBe(false);
    });

    it("removes nothing and returns undefined when the incidentId does not own the link", async () => {
      // Link belongs to inc-1; the caller is authorized against inc-2 (a
      // different incident they manage). The spoofed pair must NOT delete.
      await insertLink({ id: "lnk-1", incidentId: "inc-1", url: "https://a" });

      expect(await service.removeLink("lnk-1", "inc-2")).toBeUndefined();
      // The link is untouched.
      expect(await linkExists("lnk-1")).toBe(true);
    });

    it("returns undefined for a link id that does not exist", async () => {
      expect(await service.removeLink("missing", "inc-1")).toBeUndefined();
    });

    it("only deletes the link matching BOTH id and incidentId", async () => {
      await insertLink({ id: "lnk-1", incidentId: "inc-1", url: "https://a" });
      await insertLink({ id: "lnk-2", incidentId: "inc-2", url: "https://b" });

      expect(await service.removeLink("lnk-1", "inc-1")).toBe("inc-1");
      expect(await linkExists("lnk-1")).toBe(false);
      // The other incident's link is untouched.
      expect(await linkExists("lnk-2")).toBe(true);
    });

    it("updateLink edits the link when the pair matches", async () => {
      await insertLink({ id: "lnk-1", incidentId: "inc-1", url: "https://a" });

      const updated = await service.updateLink({
        id: "lnk-1",
        incidentId: "inc-1",
        label: "Runbook",
        url: "https://b",
        visibility: "internal",
      });
      expect(updated?.label).toBe("Runbook");
      expect(updated?.url).toBe("https://b");
      expect(updated?.visibility).toBe("internal");

      const res = await pool.query(
        `SELECT url, label, visibility FROM "${SCHEMA}".incident_links WHERE id = $1`,
        ["lnk-1"],
      );
      expect(res.rows[0]).toEqual({
        url: "https://b",
        label: "Runbook",
        visibility: "internal",
      });
    });

    it("updateLink edits nothing and returns undefined when the incidentId does not own the link", async () => {
      await insertLink({ id: "lnk-1", incidentId: "inc-1", url: "https://a" });

      // Link belongs to inc-1; the caller is authorized against inc-2. The
      // spoofed pair must NOT edit.
      expect(
        await service.updateLink({
          id: "lnk-1",
          incidentId: "inc-2",
          url: "https://evil",
        }),
      ).toBeUndefined();

      const res = await pool.query(
        `SELECT url FROM "${SCHEMA}".incident_links WHERE id = $1`,
        ["lnk-1"],
      );
      // The link is untouched.
      expect(res.rows[0].url).toBe("https://a");
    });

    it("updateLink returns undefined for a link id that does not exist", async () => {
      expect(
        await service.updateLink({
          id: "missing",
          incidentId: "inc-1",
          url: "https://x",
        }),
      ).toBeUndefined();
    });
  },
);
