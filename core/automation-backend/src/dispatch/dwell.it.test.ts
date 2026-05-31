/**
 * Integration test (real Postgres) for the dwell-store atomic claim.
 *
 * Part of the surgical integration lane (plan §14.4 #2). It pins the one
 * behaviour fakes cannot model: the `DELETE … RETURNING` claim in
 * `dwell-store.ts` must be atomic, so that two concurrent `delete(id)` calls
 * (two pods, or the sweeper racing the queue consumer) result in EXACTLY ONE
 * returning a row. That is what stops the same dwell from firing twice.
 *
 * Gated behind `CHECKSTACK_IT=1` so the default `bun test` never runs it. The
 * `integration` CI job sets the flag and provides a real Postgres service
 * container. Connection comes from `CHECKSTACK_IT_PG_URL` (defaulting to the
 * `docker-compose-dev.yml` Postgres port).
 *
 * Each run isolates itself in a freshly created Postgres schema (set as the
 * pool's `search_path`) so it never collides with a real deployment's tables
 * and cleans up after itself. The two tables are created with minimal DDL
 * that mirrors only the columns the dwell store reads/writes.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { automationDwellTimers } from "../schema";
import { createDwellStore } from "./dwell-store";

const PG_URL =
  process.env.CHECKSTACK_IT_PG_URL ??
  "postgres://postgres:postgres@localhost:5432/postgres";

// Unique, identifier-safe schema name for this run (no interpolation into DDL
// beyond this controlled value).
const SCHEMA = `it_dwell_${crypto.randomUUID().replace(/-/g, "")}`;

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "dwell-store atomic claim (real Postgres)",
  () => {
    let pool: Pool;

    beforeAll(async () => {
      // First, create the schema on a plain connection.
      const setupPool = new Pool({ connectionString: PG_URL });
      try {
        await setupPool.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
        await setupPool.query(`SET search_path TO "${SCHEMA}"`);
        // Minimal parent table for the FK reference.
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
        // The dwell-timer table the store operates on.
        await setupPool.query(`
          CREATE TABLE "${SCHEMA}".automation_dwell_timers (
            id text PRIMARY KEY,
            automation_id text NOT NULL
              REFERENCES "${SCHEMA}".automations(id) ON DELETE CASCADE,
            trigger_id text NOT NULL,
            event_id text NOT NULL,
            context_key text,
            armed_status text,
            payload_snapshot jsonb NOT NULL,
            actor_snapshot jsonb NOT NULL,
            fire_at timestamp NOT NULL,
            created_at timestamp NOT NULL DEFAULT now()
          )
        `);
        await setupPool.query(`
          CREATE UNIQUE INDEX automation_dwell_timers_key_unique
            ON "${SCHEMA}".automation_dwell_timers
            (automation_id, trigger_id, context_key)
        `);
      } finally {
        await setupPool.end();
      }

      // Pin every pooled connection to the test schema via search_path so the
      // drizzle queries (which run on arbitrary pooled connections) all see
      // our tables.
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

    it("two concurrent delete(id) calls → exactly one returns a row", async () => {
      const db = drizzle({
        client: pool,
        schema: { automationDwellTimers },
      });
      const store = createDwellStore(db);

      const automationId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO "${SCHEMA}".automations (id, name, definition)
           VALUES ($1, $2, $3)`,
        [automationId, "IT dwell automation", JSON.stringify({})],
      );

      // Arm a single dwell to claim.
      const armed = await store.arm({
        automationId,
        triggerId: "trigger-1",
        eventId: "incident.incident.created",
        contextKey: "sys-1",
        armedStatus: "degraded",
        payloadSnapshot: { hello: "world" },
        actorSnapshot: { kind: "system" },
        fireAt: new Date(Date.now() + 60_000),
      });
      expect(armed.created).toBe(true);

      // Fire two concurrent claims for the SAME id. Exactly one must win.
      const [a, b] = await Promise.all([
        store.delete(armed.id),
        store.delete(armed.id),
      ]);

      const winners = [a, b].filter(Boolean);
      expect(winners).toHaveLength(1);

      // And the row is gone — a third claim finds nothing.
      const third = await store.delete(armed.id);
      expect(third).toBe(false);
    });
  },
);
