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

/**
 * `creatorTeamIds` backs `hasCreateCapability` and the `create.alsoAcceptCreatorOf`
 * sibling gate. It must return ONLY teams holding a type-level `creator` grant -
 * an `editor`/`owner` grant on a concrete instance (instance manage) must NOT
 * count, or the sibling gate would leak create authority to mere instance
 * managers.
 */
describe.skipIf(!process.env.CHECKSTACK_IT)(
  "RelationTupleStore.creatorTeamIds (shared Postgres)",
  () => {
    let admin2: Pool;
    let pool2: Pool;
    let store2: RelationTupleStore;
    const SCHEMA2 = "rts_it_creatorteamids";

    beforeAll(async () => {
      admin2 = new Pool({ connectionString: PG_URL });
      await admin2.query(`DROP SCHEMA IF EXISTS "${SCHEMA2}" CASCADE`);
      await admin2.query(`CREATE SCHEMA "${SCHEMA2}"`);
      await admin2.query(
        `CREATE TABLE "${SCHEMA2}".relation_tuple (
          object_type text NOT NULL,
          object_id text NOT NULL,
          relation text NOT NULL,
          subject_type text NOT NULL,
          subject_id text NOT NULL,
          created_at timestamp NOT NULL DEFAULT now(),
          PRIMARY KEY (object_type, object_id, relation, subject_type, subject_id)
        )`,
      );
      pool2 = new Pool({
        connectionString: PG_URL,
        options: `-c search_path=${SCHEMA2}`,
      });
      const db = drizzle(pool2, {
        schema,
      }) as unknown as SafeDatabase<typeof schema>;
      store2 = new RelationTupleStore(db);
    });

    afterAll(async () => {
      await pool2?.end();
      await admin2.query(`DROP SCHEMA IF EXISTS "${SCHEMA2}" CASCADE`);
      await admin2.end();
    });

    beforeEach(async () => {
      await pool2.query(`TRUNCATE "${SCHEMA2}".relation_tuple`);
    });

    const insert2 = (row: TupleRow) =>
      pool2.query(
        `INSERT INTO "${SCHEMA2}".relation_tuple
           (object_type, object_id, relation, subject_type, subject_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          row.objectType,
          row.objectId,
          row.relation,
          row.subjectType,
          row.subjectId,
        ],
      );

    it("returns a team holding a type-level creator grant", async () => {
      await insert2({
        objectType: TYPE,
        objectId: "*",
        relation: "creator",
        subjectType: "team",
        subjectId: TEAM,
      });
      expect(
        await store2.creatorTeamIds({ objectType: TYPE, userTeamIds: [TEAM] }),
      ).toEqual([TEAM]);
    });

    it("does NOT count an editor/owner grant on a concrete instance (strict creator)", async () => {
      await insert2({
        objectType: TYPE,
        objectId: "hc-1",
        relation: "editor",
        subjectType: "team",
        subjectId: TEAM,
      });
      await insert2({
        objectType: TYPE,
        objectId: "hc-2",
        relation: "owner",
        subjectType: "team",
        subjectId: TEAM,
      });
      expect(
        await store2.creatorTeamIds({ objectType: TYPE, userTeamIds: [TEAM] }),
      ).toEqual([]);
    });

    it("excludes a creator grant held only by a team the caller is not in", async () => {
      await insert2({
        objectType: TYPE,
        objectId: "*",
        relation: "creator",
        subjectType: "team",
        subjectId: OTHER_TEAM,
      });
      expect(
        await store2.creatorTeamIds({ objectType: TYPE, userTeamIds: [TEAM] }),
      ).toEqual([]);
    });

    it("does not cross resource types", async () => {
      await insert2({
        objectType: "catalog.system",
        objectId: "*",
        relation: "creator",
        subjectType: "team",
        subjectId: TEAM,
      });
      expect(
        await store2.creatorTeamIds({
          objectType: "catalog.group",
          userTeamIds: [TEAM],
        }),
      ).toEqual([]);
    });
  },
);

/**
 * `listObjectRelationsBulk` backs the per-row owner badge on the catalog Groups
 * and Environments tabs. It must return an entry for EVERY requested id (so the
 * caller can zip results back to rows), group team grants by object, expose only
 * team read-grants (never `creator`/type-level tuples), and read the privacy
 * marker per object.
 */
describe.skipIf(!process.env.CHECKSTACK_IT)(
  "RelationTupleStore.listObjectRelationsBulk (shared Postgres)",
  () => {
    let admin3: Pool;
    let pool3: Pool;
    let store3: RelationTupleStore;
    const SCHEMA3 = "rts_it_objectrelationsbulk";
    const OTYPE = "catalog.group";

    beforeAll(async () => {
      admin3 = new Pool({ connectionString: PG_URL });
      await admin3.query(`DROP SCHEMA IF EXISTS "${SCHEMA3}" CASCADE`);
      await admin3.query(`CREATE SCHEMA "${SCHEMA3}"`);
      await admin3.query(
        `CREATE TABLE "${SCHEMA3}".relation_tuple (
          object_type text NOT NULL,
          object_id text NOT NULL,
          relation text NOT NULL,
          subject_type text NOT NULL,
          subject_id text NOT NULL,
          created_at timestamp NOT NULL DEFAULT now(),
          PRIMARY KEY (object_type, object_id, relation, subject_type, subject_id)
        )`,
      );
      pool3 = new Pool({
        connectionString: PG_URL,
        options: `-c search_path=${SCHEMA3}`,
      });
      const db = drizzle(pool3, {
        schema,
      }) as unknown as SafeDatabase<typeof schema>;
      store3 = new RelationTupleStore(db);
    });

    afterAll(async () => {
      await pool3?.end();
      await admin3.query(`DROP SCHEMA IF EXISTS "${SCHEMA3}" CASCADE`);
      await admin3.end();
    });

    beforeEach(async () => {
      await pool3.query(`TRUNCATE "${SCHEMA3}".relation_tuple`);
    });

    const insert3 = (row: TupleRow) =>
      pool3.query(
        `INSERT INTO "${SCHEMA3}".relation_tuple
           (object_type, object_id, relation, subject_type, subject_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          row.objectType,
          row.objectId,
          row.relation,
          row.subjectType,
          row.subjectId,
        ],
      );

    it("returns []", async () => {
      expect(
        await store3.listObjectRelationsBulk({
          objectType: OTYPE,
          objectIds: [],
        }),
      ).toEqual([]);
    });

    it("returns an entry for every requested id, defaulting unknown ids to open", async () => {
      await insert3({
        objectType: OTYPE,
        objectId: "grp-1",
        relation: "owner",
        subjectType: "team",
        subjectId: TEAM,
      });
      const result = await store3.listObjectRelationsBulk({
        objectType: OTYPE,
        objectIds: ["grp-1", "grp-missing"],
      });
      expect(result).toEqual([
        {
          objectId: "grp-1",
          teams: [{ teamId: TEAM, relation: "owner" }],
          isPublic: true,
        },
        { objectId: "grp-missing", teams: [], isPublic: true },
      ]);
    });

    it("groups multiple team grants per object and ignores non-team/creator tuples", async () => {
      await insert3({
        objectType: OTYPE,
        objectId: "grp-1",
        relation: "owner",
        subjectType: "team",
        subjectId: TEAM,
      });
      await insert3({
        objectType: OTYPE,
        objectId: "grp-1",
        relation: "viewer",
        subjectType: "team",
        subjectId: OTHER_TEAM,
      });
      // A type-level creator tuple must NOT surface as an object grant.
      await insert3({
        objectType: OTYPE,
        objectId: "*",
        relation: "creator",
        subjectType: "team",
        subjectId: TEAM,
      });
      const [row] = await store3.listObjectRelationsBulk({
        objectType: OTYPE,
        objectIds: ["grp-1"],
      });
      expect(row.objectId).toBe("grp-1");
      expect(row.isPublic).toBe(true);
      expect(
        [...row.teams].sort((a, b) => a.teamId.localeCompare(b.teamId)),
      ).toEqual([
        { teamId: TEAM, relation: "owner" },
        { teamId: OTHER_TEAM, relation: "viewer" },
      ]);
    });

    it("reads the privacy marker per object", async () => {
      await insert3({
        objectType: OTYPE,
        objectId: "grp-private",
        relation: "owner",
        subjectType: "team",
        subjectId: TEAM,
      });
      await insert3({
        objectType: OTYPE,
        objectId: "grp-private",
        relation: "private",
        subjectType: "public",
        subjectId: "*",
      });
      const [row] = await store3.listObjectRelationsBulk({
        objectType: OTYPE,
        objectIds: ["grp-private"],
      });
      expect(row.isPublic).toBe(false);
      expect(row.teams).toEqual([{ teamId: TEAM, relation: "owner" }]);
    });
  },
);
