/**
 * Integration tests for RelationTupleStore.hasAnyTypeGrant against a REAL
 * Postgres, exercising the actual SQL WHERE clause (which the mocked-DB unit
 * tests in teams.test.ts cannot). This is the coverage that proves a real team
 * grant authorizes the `typeScoped` utility endpoints: a viewer/editor/owner
 * grant on a concrete object satisfies read; a type-level `creator` grant
 * satisfies the gate only when `includeCreator` is set (the create-first path);
 * and an unrelated team is denied.
 *
 * Gated on CHECKSTACK_IT so it runs in CI (shared compose Postgres) and is
 * skipped in the default `bun test` run, matching the other *.it.test.ts here.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { SafeDatabase } from "@checkstack/backend-api";
import * as schema from "./schema";
import { RelationTupleStore } from "./relation-tuple-store";

const PG_URL =
  process.env.CHECKSTACK_IT_PG_URL ??
  "postgres://postgres:postgres@localhost:5432/postgres";
const SCHEMA = "rts_it_hasanytypegrant";

const TYPE = "healthcheck.healthcheck";
const TEAM = "team-1";
const OTHER_TEAM = "team-2";

let admin: Pool;
let pool: Pool;
let store: RelationTupleStore;

interface TupleRow {
  objectType: string;
  objectId: string;
  relation: string;
  subjectType: string;
  subjectId: string;
}

async function insertTuple(row: TupleRow): Promise<void> {
  await pool.query(
    `INSERT INTO "${SCHEMA}".relation_tuple
       (object_type, object_id, relation, subject_type, subject_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [row.objectType, row.objectId, row.relation, row.subjectType, row.subjectId],
  );
}

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "RelationTupleStore.hasAnyTypeGrant (shared Postgres)",
  () => {
    beforeAll(async () => {
      admin = new Pool({ connectionString: PG_URL });
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
      await admin.query(
        `CREATE TABLE "${SCHEMA}".relation_tuple (
          object_type text NOT NULL,
          object_id text NOT NULL,
          relation text NOT NULL,
          subject_type text NOT NULL,
          subject_id text NOT NULL,
          created_at timestamp NOT NULL DEFAULT now(),
          PRIMARY KEY (object_type, object_id, relation, subject_type, subject_id)
        )`,
      );
      pool = new Pool({
        connectionString: PG_URL,
        options: `-c search_path=${SCHEMA}`,
      });
      const db = drizzle(pool, {
        schema,
      }) as unknown as SafeDatabase<typeof schema>;
      store = new RelationTupleStore(db);
    });

    afterAll(async () => {
      await pool?.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.end();
    });

    beforeEach(async () => {
      await pool.query(`TRUNCATE "${SCHEMA}".relation_tuple`);
    });

    it("denies when the caller belongs to no teams", async () => {
      await insertTuple({
        objectType: TYPE,
        objectId: "hc-1",
        relation: "editor",
        subjectType: "team",
        subjectId: TEAM,
      });
      expect(
        await store.hasAnyTypeGrant({
          objectType: TYPE,
          userTeamIds: [],
          action: "read",
        }),
      ).toBe(false);
    });

    it("authorizes read via a viewer grant on a concrete object", async () => {
      await insertTuple({
        objectType: TYPE,
        objectId: "hc-1",
        relation: "viewer",
        subjectType: "team",
        subjectId: TEAM,
      });
      expect(
        await store.hasAnyTypeGrant({
          objectType: TYPE,
          userTeamIds: [TEAM],
          action: "read",
        }),
      ).toBe(true);
      // A viewer cannot MANAGE.
      expect(
        await store.hasAnyTypeGrant({
          objectType: TYPE,
          userTeamIds: [TEAM],
          action: "manage",
        }),
      ).toBe(false);
    });

    it("authorizes manage via an editor grant", async () => {
      await insertTuple({
        objectType: TYPE,
        objectId: "hc-1",
        relation: "editor",
        subjectType: "team",
        subjectId: TEAM,
      });
      expect(
        await store.hasAnyTypeGrant({
          objectType: TYPE,
          userTeamIds: [TEAM],
          action: "manage",
        }),
      ).toBe(true);
    });

    it("counts a type-level creator grant ONLY when includeCreator is set", async () => {
      // A team that may CREATE the type but owns no instance yet: the `creator`
      // tuple lives on the type object id ("*").
      await insertTuple({
        objectType: TYPE,
        objectId: "*",
        relation: "creator",
        subjectType: "team",
        subjectId: TEAM,
      });

      // Default (list/record post-filter semantics): a creator with no instance
      // has nothing to list, so it must NOT read as "has a grant".
      expect(
        await store.hasAnyTypeGrant({
          objectType: TYPE,
          userTeamIds: [TEAM],
          action: "read",
        }),
      ).toBe(false);

      // typeScoped gate: the create-first path must be authorized.
      expect(
        await store.hasAnyTypeGrant({
          objectType: TYPE,
          userTeamIds: [TEAM],
          action: "read",
          includeCreator: true,
        }),
      ).toBe(true);
      expect(
        await store.hasAnyTypeGrant({
          objectType: TYPE,
          userTeamIds: [TEAM],
          action: "manage",
          includeCreator: true,
        }),
      ).toBe(true);
    });

    it("denies when only a DIFFERENT team holds the grant", async () => {
      await insertTuple({
        objectType: TYPE,
        objectId: "hc-1",
        relation: "owner",
        subjectType: "team",
        subjectId: OTHER_TEAM,
      });
      expect(
        await store.hasAnyTypeGrant({
          objectType: TYPE,
          userTeamIds: [TEAM],
          action: "read",
          includeCreator: true,
        }),
      ).toBe(false);
    });

    it("denies a grant of a DIFFERENT resource type", async () => {
      await insertTuple({
        objectType: "catalog.system",
        objectId: "sys-1",
        relation: "editor",
        subjectType: "team",
        subjectId: TEAM,
      });
      expect(
        await store.hasAnyTypeGrant({
          objectType: TYPE,
          userTeamIds: [TEAM],
          action: "read",
          includeCreator: true,
        }),
      ).toBe(false);
    });
  },
);
