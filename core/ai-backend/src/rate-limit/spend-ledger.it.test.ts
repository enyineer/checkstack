/**
 * Per-integration LLM spend-cap cross-pod enforcement (real Postgres) — Phase 6,
 * state-and-scale §14.5.
 *
 * The spend cap is a shared-Postgres ROLLING-WINDOW SUM over `ai_spend`: the
 * spend is the total tokens a principal has incurred against an integration in
 * the trailing window. Because the sum is read from the SAME shared table that
 * every pod writes to, the cap holds across ALL pods. An in-memory per-pod token
 * counter would let N pods EACH allow the cap = N x the intended spend — a leak a
 * single-process unit test can never catch. This test simulates TWO pods (two
 * independent pools to the SAME schema) and asserts the combined token usage is
 * counted against ONE shared cap (mirrors the tool-budget cross-pod IT).
 *
 * Gated behind `CHECKSTACK_IT=1`; connection from `CHECKSTACK_IT_PG_URL`. Runs in
 * a freshly created, self-cleaning schema.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { SafeDatabase } from "@checkstack/backend-api";
import type { AiSpendCap } from "@checkstack/ai-common";
import * as schema from "../schema";
import type { AuditPrincipal } from "../propose-apply/store";
import {
  SpendCapExceededError,
  checkSpendCap,
  enforceSpendCap,
  recordSpend,
} from "./spend-ledger";

const PG_URL =
  process.env.CHECKSTACK_IT_PG_URL ??
  "postgres://postgres:postgres@localhost:5432/postgres";

const SCHEMA = `it_ai_spend_${crypto.randomUUID().replace(/-/g, "")}`;
const INTEGRATION = "ai.openai-compatible.c1";

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

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "per-integration spend cap (shared Postgres, cross-pod)",
  () => {
    let admin: Pool;
    let podA: Pod;
    let podB: Pod;

    beforeAll(async () => {
      admin = new Pool({ connectionString: PG_URL });
      await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
      await admin.query(`
        CREATE TABLE "${SCHEMA}".ai_spend (
          id text PRIMARY KEY,
          integration_id text NOT NULL,
          principal_kind text NOT NULL,
          principal_id text NOT NULL,
          conversation_id text,
          model text,
          input_tokens integer NOT NULL DEFAULT 0,
          output_tokens integer NOT NULL DEFAULT 0,
          total_tokens integer NOT NULL DEFAULT 0,
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

    it("sums token usage from BOTH pods against ONE shared cap (no N x leak)", async () => {
      const principal: AuditPrincipal = { kind: "user", id: "spend-u1" };
      const cap: AiSpendCap = { tokenBudget: 1000, windowMinutes: 60 };

      // Record turns on ALTERNATING pods. Whichever pod later checks the cap
      // sees the COMBINED total, because the ledger is the shared table.
      await recordSpend({
        db: podA.db,
        integrationId: INTEGRATION,
        principal,
        usage: { inputTokens: 200, outputTokens: 100 }, // 300
      });
      await recordSpend({
        db: podB.db,
        integrationId: INTEGRATION,
        principal,
        usage: { inputTokens: 250, outputTokens: 150 }, // 400 -> 700
      });

      // 700 < 1000: a new turn is within budget, read from EITHER pod.
      const onA = await checkSpendCap({
        db: podA.db,
        integrationId: INTEGRATION,
        principal,
        cap,
      });
      const onB = await checkSpendCap({
        db: podB.db,
        integrationId: INTEGRATION,
        principal,
        cap,
      });
      expect(onA.used).toBe(700);
      expect(onB.used).toBe(700);
      expect(onA.allowed).toBe(true);
      expect(onB.allowed).toBe(true);

      // One more turn (on pod B) crosses the cap.
      await recordSpend({
        db: podB.db,
        integrationId: INTEGRATION,
        principal,
        usage: { inputTokens: 200, outputTokens: 200 }, // 400 -> 1100
      });

      // Now BOTH pods agree the principal is over the SHARED cap — not 1000/pod.
      const overA = await checkSpendCap({
        db: podA.db,
        integrationId: INTEGRATION,
        principal,
        cap,
      });
      const overB = await checkSpendCap({
        db: podB.db,
        integrationId: INTEGRATION,
        principal,
        cap,
      });
      expect(overA.used).toBe(1100);
      expect(overB.used).toBe(1100);
      expect(overA.allowed).toBe(false);
      expect(overB.allowed).toBe(false);

      await expect(
        enforceSpendCap({
          db: podA.db,
          integrationId: INTEGRATION,
          principal,
          cap,
        }),
      ).rejects.toBeInstanceOf(SpendCapExceededError);
      await expect(
        enforceSpendCap({
          db: podB.db,
          integrationId: INTEGRATION,
          principal,
          cap,
        }),
      ).rejects.toBeInstanceOf(SpendCapExceededError);
    });

    it("the cap is per-integration: spend on one integration does not block another", async () => {
      const principal: AuditPrincipal = { kind: "user", id: "spend-u2" };
      const cap: AiSpendCap = { tokenBudget: 100, windowMinutes: 60 };
      await recordSpend({
        db: podA.db,
        integrationId: "ai.openai-compatible.c1",
        principal,
        usage: { inputTokens: 200, outputTokens: 0 }, // over on c1
      });
      // c1 is over; c2 has no spend, so a turn there is still allowed.
      await expect(
        enforceSpendCap({
          db: podB.db,
          integrationId: "ai.openai-compatible.c1",
          principal,
          cap,
        }),
      ).rejects.toBeInstanceOf(SpendCapExceededError);
      await expect(
        enforceSpendCap({
          db: podB.db,
          integrationId: "ai.openai-compatible.c2",
          principal,
          cap,
        }),
      ).resolves.toBeUndefined();
    });

    it("the window slides: only recent spend counts (older turns drop out)", async () => {
      const principal: AuditPrincipal = { kind: "user", id: "spend-window" };
      // An OLD turn outside the window.
      await podA.pool.query(
        `INSERT INTO "${SCHEMA}".ai_spend
           (id, integration_id, principal_kind, principal_id, total_tokens, created_at)
         VALUES ($1, $2, 'user', $3, 5000, now() - interval '120 minutes')`,
        [crypto.randomUUID(), INTEGRATION, principal.id],
      );
      // A recent one.
      await recordSpend({
        db: podB.db,
        integrationId: INTEGRATION,
        principal,
        usage: { inputTokens: 10, outputTokens: 10 },
      });
      // With a 60-minute window the old 5000-token turn is excluded.
      const result = await checkSpendCap({
        db: podB.db,
        integrationId: INTEGRATION,
        principal,
        cap: { tokenBudget: 1000, windowMinutes: 60 },
      });
      expect(result.used).toBe(20);
      expect(result.allowed).toBe(true);
    });
  },
);
