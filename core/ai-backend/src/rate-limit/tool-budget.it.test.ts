/**
 * Per-principal tool-budget cross-pod enforcement (real Postgres) — matrix #17,
 * plan §14.5, state-and-scale §9.
 *
 * The per-principal tool budget is a shared-Postgres ROLLING-WINDOW counter over
 * `ai_tool_calls`: the budget is the number of rows the principal has written in
 * the trailing window. Because the count is read from the SAME shared table that
 * every pod writes to, the cap holds across ALL pods. An in-memory per-pod
 * limiter would let N pods EACH allow the cap = N x the intended limit — a leak a
 * single-process unit test can never catch. This test simulates TWO pods (two
 * independent pools to the SAME schema) and asserts the combined activity is
 * counted against ONE shared budget (mirrors the P2 DCR cross-pod IT).
 *
 * Gated behind `CHECKSTACK_IT=1`; connection from `CHECKSTACK_IT_PG_URL`. Runs in
 * a freshly created, self-cleaning schema.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { SafeDatabase } from "@checkstack/backend-api";
import * as schema from "../schema";
import type { AuditPrincipal } from "../propose-apply/store";
import {
  ToolBudgetExceededError,
  checkToolBudget,
  enforceToolBudget,
} from "./tool-budget";

const PG_URL =
  process.env.CHECKSTACK_IT_PG_URL ??
  "postgres://postgres:postgres@localhost:5432/postgres";

const SCHEMA = `it_ai_budget_${crypto.randomUUID().replace(/-/g, "")}`;

interface Pod {
  pool: Pool;
  db: SafeDatabase<typeof schema>;
  end(): Promise<void>;
}

function makePod(): Pod {
  const pool = new Pool({
    connectionString: PG_URL,
    options: `-c search_path=${SCHEMA}`,
  });
  const db = drizzle(pool, { schema }) as unknown as SafeDatabase<typeof schema>;
  return { pool, db, end: () => pool.end() };
}

/** Insert one `ai_tool_calls` row (a recorded tool invocation) on a given pod. */
async function recordCall(pod: Pod, principal: AuditPrincipal): Promise<void> {
  await pod.pool.query(
    `INSERT INTO "${SCHEMA}".ai_tool_calls
       (id, principal_kind, principal_id, transport, tool_name, effect, args_hash, status)
     VALUES ($1, $2, $3, 'mcp', 'incident.list', 'read', 'h', 'executed')`,
    [crypto.randomUUID(), principal.kind, principal.id],
  );
}

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "per-principal tool budget (shared Postgres, cross-pod)",
  () => {
    let admin: Pool;
    let podA: Pod;
    let podB: Pod;

    beforeAll(async () => {
      admin = new Pool({ connectionString: PG_URL });
      await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
      // The minimal columns checkToolBudget counts over (principal + createdAt).
      await admin.query(`
        CREATE TABLE "${SCHEMA}".ai_tool_calls (
          id text PRIMARY KEY,
          principal_kind text NOT NULL,
          principal_id text NOT NULL,
          transport text NOT NULL,
          conversation_id text,
          tool_name text NOT NULL,
          effect text NOT NULL,
          args_hash text NOT NULL,
          status text NOT NULL,
          proposal_nonce text,
          proposal_expires_at timestamp,
          applied_by_kind text,
          applied_by_id text,
          result_snapshot jsonb,
          proposed_payload jsonb,
          error text,
          proposed_at timestamp,
          applied_at timestamp,
          created_at timestamp NOT NULL DEFAULT now()
        )
      `);
      podA = makePod();
      podB = makePod();
    });

    afterAll(async () => {
      await podA?.end();
      await podB?.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.end();
    });

    it("counts activity from BOTH pods against ONE shared budget (no N x leak)", async () => {
      const principal: AuditPrincipal = { kind: "user", id: "budget-u1" };
      const max = 4;

      // Alternate the pod that records each call. Whichever pod later checks the
      // budget sees the COMBINED count, because the counter is the shared table.
      await recordCall(podA, principal);
      await recordCall(podB, principal);
      await recordCall(podA, principal);

      // 3 recorded < 4: a new call is within budget, read from EITHER pod.
      const onA = await checkToolBudget({ db: podA.db, principal, max });
      const onB = await checkToolBudget({ db: podB.db, principal, max });
      expect(onA.used).toBe(3);
      expect(onB.used).toBe(3);
      expect(onA.allowed).toBe(true);
      expect(onB.allowed).toBe(true);

      // One more recorded call (on pod B) reaches the cap.
      await recordCall(podB, principal);

      // Now BOTH pods agree the principal is at/over budget — not 4-per-pod.
      const overA = await checkToolBudget({ db: podA.db, principal, max });
      const overB = await checkToolBudget({ db: podB.db, principal, max });
      expect(overA.used).toBe(4);
      expect(overB.used).toBe(4);
      expect(overA.allowed).toBe(false);
      expect(overB.allowed).toBe(false);
    });

    it("enforceToolBudget throws cross-pod once the shared cap is met", async () => {
      const principal: AuditPrincipal = { kind: "application", id: "budget-app" };
      const max = 2;
      await recordCall(podA, principal);
      await recordCall(podB, principal);

      // Within-budget check on a fresh principal stays under: assert the throw is
      // driven by the SHARED count, not pod-local state.
      await expect(
        enforceToolBudget({ db: podB.db, principal, max }),
      ).rejects.toBeInstanceOf(ToolBudgetExceededError);
      await expect(
        enforceToolBudget({ db: podA.db, principal, max }),
      ).rejects.toBeInstanceOf(ToolBudgetExceededError);
    });

    it("the window slides: only recent calls count (older ones drop out)", async () => {
      const principal: AuditPrincipal = { kind: "user", id: "budget-window" };
      // Insert a row with an OLD created_at (outside the window).
      await podA.pool.query(
        `INSERT INTO "${SCHEMA}".ai_tool_calls
           (id, principal_kind, principal_id, transport, tool_name, effect, args_hash, status, created_at)
         VALUES ($1, 'user', $2, 'mcp', 'incident.list', 'read', 'h', 'executed', now() - interval '10 minutes')`,
        [crypto.randomUUID(), principal.id],
      );
      // A recent one.
      await recordCall(podB, principal);

      // With a 1-minute window the old row is excluded; only the recent counts.
      const result = await checkToolBudget({
        db: podB.db,
        principal,
        max: 60,
        windowMs: 60_000,
      });
      expect(result.used).toBe(1);
    });
  },
);
