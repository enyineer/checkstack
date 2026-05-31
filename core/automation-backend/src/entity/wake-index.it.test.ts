/**
 * Integration test (real Postgres) for the wake-index arm race + lookup.
 *
 * Part of the surgical integration lane (plan §14.4 #3). It pins the two
 * behaviours fakes cannot model against real Postgres:
 *
 *   1. The `(wait_lock_id, ref)` UNIQUE index + `ON CONFLICT DO NOTHING`
 *      arm: concurrent inserts of the SAME pair must leave EXACTLY ONE row
 *      (the arm race must not double-insert).
 *   2. The key-intersection lookup join (§8.2) returns the owning
 *      `kind: "until"` wait lock for a changed `kind:id` ref, including the
 *      kind-level wildcard.
 *
 * Gated behind `CHECKSTACK_IT=1` so the default `bun test` never runs it. The
 * `integration` CI job sets the flag and provides a real Postgres service.
 * Connection comes from `CHECKSTACK_IT_PG_URL` (defaulting to the
 * `docker-compose-dev.yml` Postgres port). Each run isolates itself in a
 * freshly created Postgres schema and cleans up after itself.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";

import {
  automationRunState,
  automationRunSteps,
  automationRuns,
  automationWaitLocks,
  automationWakeIndex,
} from "../schema";
import { createRunStore } from "../dispatch/run-state";

const PG_URL =
  process.env.CHECKSTACK_IT_PG_URL ??
  "postgres://postgres:postgres@localhost:5432/postgres";

const SCHEMA = `it_wake_${crypto.randomUUID().replace(/-/g, "")}`;

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "wake-index arm race + intersection lookup (real Postgres)",
  () => {
    let pool: Pool;

    beforeAll(async () => {
      const setupPool = new Pool({ connectionString: PG_URL });
      try {
        await setupPool.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
        await setupPool.query(`SET search_path TO "${SCHEMA}"`);
        await setupPool.query(`
          CREATE TABLE "${SCHEMA}".automations (
            id text PRIMARY KEY,
            name text NOT NULL,
            status text NOT NULL DEFAULT 'enabled',
            definition jsonb NOT NULL,
            created_at timestamp NOT NULL DEFAULT now(),
            updated_at timestamp NOT NULL DEFAULT now()
          )
        `);
        await setupPool.query(`
          CREATE TABLE "${SCHEMA}".automation_runs (
            id text PRIMARY KEY,
            automation_id text NOT NULL,
            trigger_id text NOT NULL,
            trigger_event_id text NOT NULL,
            trigger_payload jsonb NOT NULL,
            context_key text,
            status text NOT NULL DEFAULT 'running',
            error_message text,
            started_at timestamp NOT NULL DEFAULT now(),
            finished_at timestamp
          )
        `);
        await setupPool.query(`
          CREATE TABLE "${SCHEMA}".automation_wait_locks (
            id text PRIMARY KEY,
            run_id text NOT NULL
              REFERENCES "${SCHEMA}".automation_runs(id) ON DELETE CASCADE,
            action_path text NOT NULL,
            kind text NOT NULL DEFAULT 'trigger',
            event_id text NOT NULL,
            context_key text,
            filter_template text,
            wait_config jsonb,
            timeout_at timestamp,
            created_at timestamp NOT NULL DEFAULT now()
          )
        `);
        await setupPool.query(`
          CREATE TABLE "${SCHEMA}".automation_wake_index (
            id text PRIMARY KEY,
            wait_lock_id text NOT NULL
              REFERENCES "${SCHEMA}".automation_wait_locks(id) ON DELETE CASCADE,
            ref text NOT NULL
          )
        `);
        await setupPool.query(`
          CREATE UNIQUE INDEX automation_wake_index_lock_ref_unique
            ON "${SCHEMA}".automation_wake_index (wait_lock_id, ref)
        `);
        await setupPool.query(`
          CREATE INDEX automation_wake_index_ref_idx
            ON "${SCHEMA}".automation_wake_index (ref)
        `);
      } finally {
        await setupPool.end();
      }

      pool = new Pool({
        connectionString: PG_URL,
        options: `-c search_path=${SCHEMA}`,
      });
    });

    afterAll(async () => {
      await pool.end();
      const cleanupPool = new Pool({ connectionString: PG_URL });
      try {
        await cleanupPool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      } finally {
        await cleanupPool.end();
      }
    });

    function makeStore() {
      const db = drizzle({
        client: pool,
        schema: {
          automationRuns,
          automationRunSteps,
          automationWaitLocks,
          automationRunState,
          automationWakeIndex,
        },
      });
      return createRunStore(db);
    }

    async function seedRun(): Promise<string> {
      const automationId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO "${SCHEMA}".automations (id, name, definition)
           VALUES ($1, $2, $3)`,
        [automationId, "IT wake automation", JSON.stringify({})],
      );
      const store = makeStore();
      return store.createRun({
        automationId,
        triggerId: "t",
        triggerEventId: "test.event",
        triggerPayload: {},
        contextKey: "sys-1",
      });
    }

    it("intersection lookup returns the owning until-lock for a concrete ref", async () => {
      const store = makeStore();
      const runId = await seedRun();
      await store.createWaitLockWithWakeRefs({
        runId,
        actionPath: "actions[0]",
        eventId: "@@until",
        contextKey: "sys-1",
        timeoutAt: null,
        waitConfig: {
          condition: "state.health['sys-1'].status == 'healthy'",
          pollSeconds: 30,
          continueOnTimeout: true,
        },
        wakeRefs: ["health:sys-1", "incident:inc-9"],
      });

      const byExact = await store.findWaitLocksByWakeRef("health:sys-1");
      expect(byExact).toHaveLength(1);
      expect(byExact[0]?.runId).toBe(runId);

      const byOther = await store.findWaitLocksByWakeRef("incident:inc-9");
      expect(byOther).toHaveLength(1);

      const noMatch = await store.findWaitLocksByWakeRef("health:other");
      expect(noMatch).toHaveLength(0);
    });

    it("matches a kind-level wildcard wait", async () => {
      const store = makeStore();
      const runId = await seedRun();
      await store.createWaitLockWithWakeRefs({
        runId,
        actionPath: "actions[0]",
        eventId: "@@until",
        contextKey: null,
        timeoutAt: null,
        waitConfig: {
          condition: "state.slo[trigger.id].budget < 10",
          pollSeconds: 30,
          continueOnTimeout: true,
        },
        wakeRefs: ["slo:*"],
      });
      const matched = await store.findWaitLocksByWakeRef("slo:obj-42");
      expect(matched.some((l) => l.runId === runId)).toBe(true);
    });

    it("concurrent same-(lock, ref) inserts leave exactly one row", async () => {
      const runId = await seedRun();
      const store = makeStore();
      // First, create the wait lock with one ref.
      const lockId = await store.createWaitLockWithWakeRefs({
        runId,
        actionPath: "actions[0]",
        eventId: "@@until",
        contextKey: "sys-1",
        timeoutAt: null,
        waitConfig: {
          condition: "state.health['sys-1'].status == 'healthy'",
          pollSeconds: 30,
          continueOnTimeout: true,
        },
        wakeRefs: ["health:sys-1"],
      });

      // Now race many concurrent inserts of the SAME (lock, ref) pair under
      // ON CONFLICT DO NOTHING — the unique index must collapse them to one.
      const db = drizzle({
        client: pool,
        schema: { automationWakeIndex },
      });
      await Promise.all(
        Array.from({ length: 8 }, () =>
          db
            .insert(automationWakeIndex)
            .values({ waitLockId: lockId, ref: "health:sys-1" })
            .onConflictDoNothing({
              target: [
                automationWakeIndex.waitLockId,
                automationWakeIndex.ref,
              ],
            }),
        ),
      );

      const rows = await db
        .select()
        .from(automationWakeIndex)
        .where(
          and(
            eq(automationWakeIndex.waitLockId, lockId),
            eq(automationWakeIndex.ref, "health:sys-1"),
          ),
        );
      expect(rows).toHaveLength(1);
    });
  },
);
