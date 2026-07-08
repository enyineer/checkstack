/**
 * Integration test for the BATCHED / SET-BASED maintenance read paths against a
 * REAL Postgres: `getMaintenance`, `listMaintenances`,
 * `getMaintenancesForSystem`, and the cron-transition helpers
 * `getMaintenancesToStart` / `getMaintenancesToComplete`. Mirrors the incident
 * twin.
 *
 * These reads were reshaped for the scoped-db query-batching sweep:
 *  - `getMaintenance` now runs its 4 sequential reads (maintenance -> systems ->
 *    updates -> links) inside ONE `withScopedTransaction` (single SET LOCAL).
 *  - `listMaintenances` / `getMaintenancesForSystem` /
 *    `getMaintenancesToStart` / `getMaintenancesToComplete` replaced a per-row
 *    N+1 system lookup with a SINGLE set-based `inArray` junction read grouped
 *    in JS (via the shared `getSystemsByMaintenance` helper).
 *
 * The mocked-DB unit tests prove the JS grouping and the query COUNT, but only
 * a real database proves the rewritten SQL (the `inArray` grouping and the
 * status filters) returns byte-identical results.
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
const SCHEMA = "maintenance_it_reads";

const START = new Date("2026-06-02T00:00:00.000Z");
const END = new Date("2026-06-02T02:00:00.000Z");

let admin: Pool;
let pool: Pool;
let service: MaintenanceService;

async function insertMaintenance(row: {
  id: string;
  status: string;
  description?: string | null;
  systemIds: string[];
  startAt?: Date;
  endAt?: Date;
}): Promise<void> {
  await pool.query(
    `INSERT INTO "${SCHEMA}".maintenances
       (id, title, description, status, start_at, end_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      row.id,
      `Maintenance ${row.id}`,
      row.description ?? null,
      row.status,
      row.startAt ?? START,
      row.endAt ?? END,
    ],
  );
  for (const systemId of row.systemIds) {
    await pool.query(
      `INSERT INTO "${SCHEMA}".maintenance_systems (maintenance_id, system_id)
       VALUES ($1, $2)`,
      [row.id, systemId],
    );
  }
}

async function insertUpdate(row: {
  id: string;
  maintenanceId: string;
  statusChange: string | null;
  visibility: string;
  createdAt: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO "${SCHEMA}".maintenance_updates
       (id, maintenance_id, message, status_change, visibility, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      row.id,
      row.maintenanceId,
      `msg-${row.id}`,
      row.statusChange,
      row.visibility,
      row.createdAt,
    ],
  );
}

async function insertLink(row: {
  id: string;
  maintenanceId: string;
  url: string;
  visibility: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO "${SCHEMA}".maintenance_links (id, maintenance_id, url, visibility)
     VALUES ($1, $2, $3, $4)`,
    [row.id, row.maintenanceId, row.url, row.visibility],
  );
}

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "MaintenanceService batched/set-based reads (shared Postgres)",
  () => {
    beforeAll(async () => {
      admin = new Pool({ connectionString: PG_URL });
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
      // Minimal DDL: enum-typed columns are plain text, keeping the schema
      // self-contained like the sibling *.it.test.ts files.
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
      await admin.query(
        `CREATE TABLE "${SCHEMA}".maintenance_links (
          id text PRIMARY KEY,
          maintenance_id text NOT NULL,
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
      service = new MaintenanceService(db);
    });

    afterAll(async () => {
      await pool?.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.end();
    });

    beforeEach(async () => {
      await pool.query(`TRUNCATE "${SCHEMA}".maintenance_links`);
      await pool.query(`TRUNCATE "${SCHEMA}".maintenance_updates`);
      await pool.query(`TRUNCATE "${SCHEMA}".maintenance_systems`);
      await pool.query(`TRUNCATE "${SCHEMA}".maintenances CASCADE`);
    });

    it("getMaintenance assembles systems, the FULL timeline, and links from one tx", async () => {
      await insertMaintenance({
        id: "m-1",
        status: "in_progress",
        description: null,
        systemIds: ["sys-b", "sys-a"],
      });
      await insertUpdate({
        id: "u-pub",
        maintenanceId: "m-1",
        statusChange: "in_progress",
        visibility: "public",
        createdAt: "2026-06-01T00:00:00Z",
      });
      // An `internal` update must still be returned by the service (audience
      // filtering happens in the router read layer, not the service).
      await insertUpdate({
        id: "u-int",
        maintenanceId: "m-1",
        statusChange: null,
        visibility: "internal",
        createdAt: "2026-06-01T01:00:00Z",
      });
      await insertLink({
        id: "lnk-1",
        maintenanceId: "m-1",
        url: "https://a",
        visibility: "public",
      });
      await insertLink({
        id: "lnk-2",
        maintenanceId: "m-1",
        url: "https://b",
        visibility: "internal",
      });

      const detail = await service.getMaintenance("m-1");

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

    it("getMaintenance returns undefined for a missing id", async () => {
      expect(await service.getMaintenance("ghost")).toBeUndefined();
    });

    it("getBulkMaintenanceUpdates returns per-id updates equivalent to getMaintenance", async () => {
      // m-1: two updates (public + internal); m-2: one; m-3: none.
      await insertMaintenance({ id: "m-1", status: "in_progress", systemIds: ["sys-a"] });
      await insertMaintenance({ id: "m-2", status: "scheduled", systemIds: ["sys-b"] });
      await insertMaintenance({ id: "m-3", status: "scheduled", systemIds: ["sys-c"] });
      await insertUpdate({
        id: "u-1a",
        maintenanceId: "m-1",
        statusChange: "in_progress",
        visibility: "public",
        createdAt: "2026-06-01T00:00:00Z",
      });
      await insertUpdate({
        id: "u-1b",
        maintenanceId: "m-1",
        statusChange: null,
        visibility: "internal",
        createdAt: "2026-06-01T01:00:00Z",
      });
      await insertUpdate({
        id: "u-2a",
        maintenanceId: "m-2",
        statusChange: null,
        visibility: "public",
        createdAt: "2026-06-01T02:00:00Z",
      });

      const ids = ["m-1", "m-2", "m-3"];
      const bulk = await service.getBulkMaintenanceUpdates(ids);

      const sortById = <T extends { id: string }>(l: T[]) =>
        [...l].toSorted((a, b) => a.id.localeCompare(b.id));
      for (const id of ids) {
        const single = (await service.getMaintenance(id))?.updates ?? [];
        expect(sortById(bulk[id] ?? [])).toEqual(sortById(single));
      }
      // Maintenances with no updates are omitted from the record.
      expect(bulk["m-3"]).toBeUndefined();
      expect(Object.keys(bulk).toSorted()).toEqual(["m-1", "m-2"]);
    });

    it("getBulkMaintenanceUpdates returns an empty map for an empty request", async () => {
      expect(await service.getBulkMaintenanceUpdates([])).toEqual({});
    });

    it("listMaintenances groups full membership per maintenance with a single junction read", async () => {
      await insertMaintenance({
        id: "m-1",
        status: "scheduled",
        systemIds: ["sys-a", "sys-b"],
      });
      await insertMaintenance({
        id: "m-2",
        status: "in_progress",
        description: "db upgrade",
        systemIds: ["sys-c"],
      });
      // Completed maintenance is hidden by default.
      await insertMaintenance({
        id: "m-3",
        status: "completed",
        systemIds: ["sys-a"],
      });

      const activeOnly = await service.listMaintenances();
      expect(activeOnly.map((m) => m.id).toSorted()).toEqual(["m-1", "m-2"]);
      expect(
        activeOnly.find((m) => m.id === "m-1")?.systemIds.toSorted(),
      ).toEqual(["sys-a", "sys-b"]);
      expect(activeOnly.find((m) => m.id === "m-2")?.description).toBe(
        "db upgrade",
      );

      // includeCompleted surfaces the completed maintenance too.
      const all = await service.listMaintenances({ includeCompleted: true });
      expect(all.map((m) => m.id).toSorted()).toEqual(["m-1", "m-2", "m-3"]);
    });

    it("getMaintenancesForSystem returns scheduled/in_progress windows with full membership", async () => {
      await insertMaintenance({
        id: "m-1",
        status: "scheduled",
        systemIds: ["sys-a", "sys-b"],
      });
      await insertMaintenance({
        id: "m-2",
        status: "in_progress",
        systemIds: ["sys-a"],
      });
      // Completed / cancelled windows on sys-a are excluded.
      await insertMaintenance({
        id: "m-3",
        status: "completed",
        systemIds: ["sys-a"],
      });
      await insertMaintenance({
        id: "m-4",
        status: "cancelled",
        systemIds: ["sys-a"],
      });
      // Different system, must not leak in.
      await insertMaintenance({
        id: "m-5",
        status: "scheduled",
        systemIds: ["sys-z"],
      });

      const forA = await service.getMaintenancesForSystem("sys-a");

      expect(forA.map((m) => m.id).toSorted()).toEqual(["m-1", "m-2"]);
      expect(
        forA.find((m) => m.id === "m-1")?.systemIds.toSorted(),
      ).toEqual(["sys-a", "sys-b"]);
    });

    it("getMaintenancesToStart batches per-maintenance systems in ONE junction read", async () => {
      const past = new Date(Date.now() - 60_000);
      const future = new Date(Date.now() + 60 * 60_000);
      // Two DUE scheduled maintenances, each with a DISTINCT multi-system set:
      // the grouping must give each exactly its own systems, none crossed.
      await insertMaintenance({
        id: "m-1",
        status: "scheduled",
        systemIds: ["sys-a", "sys-b"],
        startAt: past,
      });
      await insertMaintenance({
        id: "m-2",
        status: "scheduled",
        systemIds: ["sys-c", "sys-d", "sys-e"],
        startAt: past,
      });
      // Not yet due (startAt in the future) - excluded.
      await insertMaintenance({
        id: "m-3",
        status: "scheduled",
        systemIds: ["sys-x"],
        startAt: future,
      });
      // Already in_progress - excluded (wrong status).
      await insertMaintenance({
        id: "m-4",
        status: "in_progress",
        systemIds: ["sys-y"],
        startAt: past,
      });

      const startable = await service.getMaintenancesToStart();

      expect(startable.map((m) => m.id).toSorted()).toEqual(["m-1", "m-2"]);
      expect(
        startable.find((m) => m.id === "m-1")?.systemIds.toSorted(),
      ).toEqual(["sys-a", "sys-b"]);
      expect(
        startable.find((m) => m.id === "m-2")?.systemIds.toSorted(),
      ).toEqual(["sys-c", "sys-d", "sys-e"]);
    });

    it("getMaintenancesToStart returns [] when nothing is due", async () => {
      await insertMaintenance({
        id: "m-1",
        status: "scheduled",
        systemIds: ["sys-a"],
        startAt: new Date(Date.now() + 60 * 60_000),
      });

      expect(await service.getMaintenancesToStart()).toEqual([]);
    });

    it("getMaintenancesToComplete batches per-maintenance systems in ONE junction read", async () => {
      const past = new Date(Date.now() - 60_000);
      const future = new Date(Date.now() + 60 * 60_000);
      // Two ENDED in_progress maintenances with DISTINCT multi-system sets.
      await insertMaintenance({
        id: "m-1",
        status: "in_progress",
        systemIds: ["sys-a", "sys-b"],
        endAt: past,
      });
      await insertMaintenance({
        id: "m-2",
        status: "in_progress",
        systemIds: ["sys-c", "sys-d", "sys-e"],
        endAt: past,
      });
      // Still running (endAt in the future) - excluded.
      await insertMaintenance({
        id: "m-3",
        status: "in_progress",
        systemIds: ["sys-x"],
        endAt: future,
      });
      // scheduled, not in_progress - excluded (wrong status).
      await insertMaintenance({
        id: "m-4",
        status: "scheduled",
        systemIds: ["sys-y"],
        endAt: past,
      });

      const completable = await service.getMaintenancesToComplete();

      expect(completable.map((m) => m.id).toSorted()).toEqual(["m-1", "m-2"]);
      expect(
        completable.find((m) => m.id === "m-1")?.systemIds.toSorted(),
      ).toEqual(["sys-a", "sys-b"]);
      expect(
        completable.find((m) => m.id === "m-2")?.systemIds.toSorted(),
      ).toEqual(["sys-c", "sys-d", "sys-e"]);
    });

    it("getMaintenancesToComplete returns [] when nothing has ended", async () => {
      await insertMaintenance({
        id: "m-1",
        status: "in_progress",
        systemIds: ["sys-a"],
        endAt: new Date(Date.now() + 60 * 60_000),
      });

      expect(await service.getMaintenancesToComplete()).toEqual([]);
    });
  },
);
