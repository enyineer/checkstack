/**
 * Integration test for the BATCHED / SET-BASED incident read paths against a
 * REAL Postgres: `getIncident`, `listIncidents`, and `getIncidentsForSystem`.
 *
 * These reads were reshaped for the scoped-db query-batching sweep:
 *  - `getIncident` now runs its 4 sequential reads (incident -> systems ->
 *    updates -> links) inside ONE `withScopedTransaction` (single SET LOCAL).
 *  - `listIncidents` / `getIncidentsForSystem` replaced a per-row N+1 system
 *    lookup with a SINGLE set-based `inArray` junction read grouped in JS.
 *
 * The mocked-DB unit tests prove the JS grouping and the query COUNT, but only
 * a real database proves the rewritten SQL (the `inArray` grouping, the status
 * filters, and the full-timeline assembly) returns byte-identical results. That
 * is exactly what this guard covers.
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
const SCHEMA = "incident_it_reads";

const noopAdvisoryLock: AdvisoryLockService = {
  tryAcquire: async () => null,
  withXactLock: async ({ fn }) => fn(),
};

let admin: Pool;
let pool: Pool;
let service: IncidentService;

async function insertIncident(row: {
  id: string;
  status: string;
  severity?: string;
  description?: string | null;
  systemIds: string[];
}): Promise<void> {
  await pool.query(
    `INSERT INTO "${SCHEMA}".incidents (id, title, description, status, severity)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      row.id,
      `Incident ${row.id}`,
      row.description ?? null,
      row.status,
      row.severity ?? "major",
    ],
  );
  for (const systemId of row.systemIds) {
    await pool.query(
      `INSERT INTO "${SCHEMA}".incident_systems (incident_id, system_id)
       VALUES ($1, $2)`,
      [row.id, systemId],
    );
  }
}

async function insertUpdate(row: {
  id: string;
  incidentId: string;
  statusChange: string | null;
  visibility: string;
  createdAt: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO "${SCHEMA}".incident_updates
       (id, incident_id, message, status_change, visibility, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      row.id,
      row.incidentId,
      `msg-${row.id}`,
      row.statusChange,
      row.visibility,
      row.createdAt,
    ],
  );
}

async function insertLink(row: {
  id: string;
  incidentId: string;
  url: string;
  visibility: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO "${SCHEMA}".incident_links (id, incident_id, url, visibility)
     VALUES ($1, $2, $3, $4)`,
    [row.id, row.incidentId, row.url, row.visibility],
  );
}

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "IncidentService batched/set-based reads (shared Postgres)",
  () => {
    beforeAll(async () => {
      admin = new Pool({ connectionString: PG_URL });
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
      // Minimal DDL: enum-typed columns are plain text (the query builder only
      // compares/filters on values), keeping the schema self-contained like the
      // sibling *.it.test.ts files.
      await admin.query(
        `CREATE TABLE "${SCHEMA}".incidents (
          id text PRIMARY KEY,
          title text NOT NULL,
          description text,
          status text NOT NULL DEFAULT 'investigating',
          severity text NOT NULL DEFAULT 'major',
          suppress_notifications boolean NOT NULL DEFAULT false,
          health_override text,
          created_at timestamp NOT NULL DEFAULT now(),
          updated_at timestamp NOT NULL DEFAULT now()
        )`,
      );
      await admin.query(
        `CREATE TABLE "${SCHEMA}".incident_systems (
          incident_id text NOT NULL,
          system_id text NOT NULL,
          PRIMARY KEY (incident_id, system_id)
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
      await pool.query(`TRUNCATE "${SCHEMA}".incident_updates`);
      await pool.query(`TRUNCATE "${SCHEMA}".incident_systems`);
      await pool.query(`TRUNCATE "${SCHEMA}".incidents CASCADE`);
    });

    it("getIncident assembles systems, the FULL timeline, and links from one tx", async () => {
      await insertIncident({
        id: "inc-1",
        status: "investigating",
        description: null,
        systemIds: ["sys-b", "sys-a"],
      });
      await insertUpdate({
        id: "u-pub",
        incidentId: "inc-1",
        statusChange: "investigating",
        visibility: "public",
        createdAt: "2026-06-01T00:00:00Z",
      });
      // An `internal` update must still be returned by the service (audience
      // filtering happens in the router read layer, not the service).
      await insertUpdate({
        id: "u-int",
        incidentId: "inc-1",
        statusChange: null,
        visibility: "internal",
        createdAt: "2026-06-01T01:00:00Z",
      });
      await insertLink({
        id: "lnk-1",
        incidentId: "inc-1",
        url: "https://a",
        visibility: "public",
      });
      await insertLink({
        id: "lnk-2",
        incidentId: "inc-1",
        url: "https://b",
        visibility: "internal",
      });

      const detail = await service.getIncident("inc-1");

      expect(detail?.systemIds.toSorted()).toEqual(["sys-a", "sys-b"]);
      expect(detail?.description).toBeUndefined();
      expect(detail?.updates.map((u) => u.id).toSorted()).toEqual([
        "u-int",
        "u-pub",
      ]);
      expect(detail?.links.map((l) => l.id).toSorted()).toEqual([
        "lnk-1",
        "lnk-2",
      ]);
    });

    it("getIncident returns undefined for a missing id", async () => {
      expect(await service.getIncident("ghost")).toBeUndefined();
    });

    it("getBulkIncidentUpdates returns per-id updates equivalent to getIncident", async () => {
      // inc-1: two updates (public + internal); inc-2: one; inc-3: none.
      await insertIncident({ id: "inc-1", status: "investigating", systemIds: ["sys-a"] });
      await insertIncident({ id: "inc-2", status: "monitoring", systemIds: ["sys-b"] });
      await insertIncident({ id: "inc-3", status: "investigating", systemIds: ["sys-c"] });
      await insertUpdate({
        id: "u-1a",
        incidentId: "inc-1",
        statusChange: "investigating",
        visibility: "public",
        createdAt: "2026-06-01T00:00:00Z",
      });
      await insertUpdate({
        id: "u-1b",
        incidentId: "inc-1",
        statusChange: null,
        visibility: "internal",
        createdAt: "2026-06-01T01:00:00Z",
      });
      await insertUpdate({
        id: "u-2a",
        incidentId: "inc-2",
        statusChange: "monitoring",
        visibility: "public",
        createdAt: "2026-06-01T02:00:00Z",
      });

      const ids = ["inc-1", "inc-2", "inc-3"];
      const bulk = await service.getBulkIncidentUpdates(ids);

      // Each id's bulk result equals the single-endpoint updates (order-agnostic).
      const byId = (list: { id: string }[]) => list.map((u) => u.id).toSorted();
      for (const id of ids) {
        const single = (await service.getIncident(id))?.updates ?? [];
        expect(byId(bulk[id] ?? [])).toEqual(byId(single));
        // Full-record equivalence (sorted by update id) for the populated ones.
        const sortById = <T extends { id: string }>(l: T[]) =>
          [...l].toSorted((a, b) => a.id.localeCompare(b.id));
        expect(sortById(bulk[id] ?? [])).toEqual(sortById(single));
      }
      // Incidents with no updates are omitted from the record.
      expect(bulk["inc-3"]).toBeUndefined();
      expect(Object.keys(bulk).toSorted()).toEqual(["inc-1", "inc-2"]);
    });

    it("getBulkIncidentUpdates returns an empty map for an empty request", async () => {
      expect(await service.getBulkIncidentUpdates([])).toEqual({});
    });

    it("listIncidents groups full membership per incident with a single junction read", async () => {
      await insertIncident({
        id: "inc-1",
        status: "investigating",
        systemIds: ["sys-a", "sys-b"],
      });
      await insertIncident({
        id: "inc-2",
        status: "monitoring",
        description: "elevated latency",
        systemIds: ["sys-c"],
      });
      // Resolved incident is hidden by default.
      await insertIncident({
        id: "inc-3",
        status: "resolved",
        systemIds: ["sys-a"],
      });

      const openOnly = await service.listIncidents();
      expect(openOnly.map((i) => i.id).toSorted()).toEqual(["inc-1", "inc-2"]);
      const inc1 = openOnly.find((i) => i.id === "inc-1");
      expect(inc1?.systemIds.toSorted()).toEqual(["sys-a", "sys-b"]);
      expect(
        openOnly.find((i) => i.id === "inc-2")?.description,
      ).toBe("elevated latency");

      // includeResolved surfaces the resolved incident too.
      const all = await service.listIncidents({ includeResolved: true });
      expect(all.map((i) => i.id).toSorted()).toEqual([
        "inc-1",
        "inc-2",
        "inc-3",
      ]);
    });

    it("getIncidentsForSystem returns non-resolved incidents with full membership", async () => {
      await insertIncident({
        id: "inc-1",
        status: "investigating",
        systemIds: ["sys-a", "sys-b"],
      });
      await insertIncident({
        id: "inc-2",
        status: "monitoring",
        systemIds: ["sys-a"],
      });
      // Resolved incident on sys-a is excluded.
      await insertIncident({
        id: "inc-3",
        status: "resolved",
        systemIds: ["sys-a"],
      });
      // Different system, must not leak in.
      await insertIncident({
        id: "inc-4",
        status: "investigating",
        systemIds: ["sys-z"],
      });

      const forA = await service.getIncidentsForSystem("sys-a");

      expect(forA.map((i) => i.id).toSorted()).toEqual(["inc-1", "inc-2"]);
      // The multi-system incident reports its FULL membership under sys-a.
      expect(
        forA.find((i) => i.id === "inc-1")?.systemIds.toSorted(),
      ).toEqual(["sys-a", "sys-b"]);
    });

    /**
     * `findExistingIncidentIds` backs viewability-aware mention rendering. It
     * is a real set-based `inArray` read, so the SQL is worth proving against
     * a database - the mocked-db unit tests only cover the router around it.
     */
    describe("findExistingIncidentIds", () => {
      it("returns only the ids that exist", async () => {
        await insertIncident({
          id: "inc-1",
          status: "investigating",
          systemIds: ["sys-a"],
        });

        const found = await service.findExistingIncidentIds([
          "inc-1",
          "inc-deleted",
        ]);

        expect(found).toEqual(["inc-1"]);
      });

      it("returns nothing for an empty input WITHOUT hitting the database", async () => {
        // `inArray(col, [])` is invalid SQL in Postgres, so the empty case has
        // to short-circuit rather than build a query.
        expect(await service.findExistingIncidentIds([])).toEqual([]);
      });

      it("returns nothing when no id exists", async () => {
        expect(
          await service.findExistingIncidentIds(["nope-1", "nope-2"]),
        ).toEqual([]);
      });

      it("de-duplicates a repeated id", async () => {
        await insertIncident({
          id: "inc-1",
          status: "investigating",
          systemIds: ["sys-a"],
        });

        expect(
          await service.findExistingIncidentIds(["inc-1", "inc-1", "inc-1"]),
        ).toEqual(["inc-1"]);
      });

      it("finds a RESOLVED incident, which the browse list hides", async () => {
        // The whole reason this is not a filter over `listIncidents`: that list
        // excludes resolved incidents by default, so deriving viewability from
        // it would silently downgrade a valid reference to plain text.
        await insertIncident({
          id: "inc-resolved",
          status: "resolved",
          systemIds: ["sys-a"],
        });

        expect(
          await service.findExistingIncidentIds(["inc-resolved"]),
        ).toEqual(["inc-resolved"]);
      });

      it("handles a large batch in one round trip", async () => {
        for (let i = 0; i < 50; i++) {
          await insertIncident({
            id: `bulk-${i}`,
            status: "investigating",
            systemIds: ["sys-a"],
          });
        }

        const asked = Array.from({ length: 200 }, (_, i) => `bulk-${i}`);
        const found = await service.findExistingIncidentIds(asked);

        expect(found.toSorted()).toEqual(
          Array.from({ length: 50 }, (_, i) => `bulk-${i}`).toSorted(),
        );
      });
    });
  },
);
