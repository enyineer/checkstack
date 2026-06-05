import { describe, expect, test, mock } from "bun:test";
import type { AiSpendCap } from "@checkstack/ai-common";
import type { AuditPrincipal } from "../propose-apply/store";
import {
  checkSpendCap,
  enforceSpendCap,
  recordSpend,
  SpendCapExceededError,
} from "./spend-ledger";

/**
 * Per-integration LLM spend cap (Phase 6, the locked-off knob, now wired).
 *
 * Unit-level proof that the cap is a shared-Postgres ROLLING-WINDOW SUM over
 * `ai_spend`: the check reads the SUM through the injected `db` (no pod-local
 * counter), enforcement throws once `used >= tokenBudget`, the cap is OFF when
 * unconfigured, and a turn's usage is recorded as input + output tokens. The
 * cross-pod property (the sum counts EVERY pod's writes) is exercised against a
 * live Postgres in `spend-ledger.it.test.ts`.
 */

const principal: AuditPrincipal = { kind: "user", id: "u1" };
const cap: AiSpendCap = { tokenBudget: 1000, windowMinutes: 60 };

/** A fake db whose SUM query resolves to `total`, simulating the ledger read. */
function sumDb(total: number) {
  const where = mock(() => Promise.resolve([{ total }]));
  const from = mock(() => ({ where }));
  const select = mock(() => ({ from }));
  return { select } as never;
}

/** A fake db capturing the inserted spend row. */
function insertDb() {
  const captured: Array<Record<string, unknown>> = [];
  const values = mock((v: Record<string, unknown>) => {
    captured.push(v);
    return Promise.resolve([]);
  });
  const insert = mock(() => ({ values }));
  return { db: { insert } as never, captured };
}

describe("checkSpendCap (rolling-window SUM over ai_spend)", () => {
  test("under budget: a new turn is allowed", async () => {
    const result = await checkSpendCap({
      db: sumDb(400),
      integrationId: "ai.openai-compatible.c1",
      principal,
      cap,
    });
    expect(result.used).toBe(400);
    expect(result.allowed).toBe(true);
    expect(result.tokenBudget).toBe(1000);
  });

  test("at/over budget: a new turn is refused (used >= tokenBudget)", async () => {
    const atCap = await checkSpendCap({
      db: sumDb(1000),
      integrationId: "c1",
      principal,
      cap,
    });
    expect(atCap.allowed).toBe(false);
    const over = await checkSpendCap({
      db: sumDb(1500),
      integrationId: "c1",
      principal,
      cap,
    });
    expect(over.allowed).toBe(false);
  });

  test("a numeric-string SUM (as pg returns it) coerces to a number", async () => {
    // pg returns sum() over an integer column as a string; the ledger coerces.
    const where = mock(() => Promise.resolve([{ total: "750" }]));
    const from = mock(() => ({ where }));
    const db = { select: mock(() => ({ from })) } as never;
    const result = await checkSpendCap({
      db,
      integrationId: "c1",
      principal,
      cap,
    });
    expect(result.used).toBe(750);
    expect(result.allowed).toBe(true);
  });

  test("the window start is now - windowMinutes (the rolling window)", async () => {
    const now = new Date("2026-06-02T12:00:00Z");
    const result = await checkSpendCap({
      db: sumDb(0),
      integrationId: "c1",
      principal,
      cap: { tokenBudget: 100, windowMinutes: 30 },
      now,
    });
    expect(result.windowStart).toEqual(new Date("2026-06-02T11:30:00Z"));
  });
});

describe("enforceSpendCap", () => {
  test("OFF by default: no cap configured = a no-op (never throws, never reads)", async () => {
    const select = mock(() => ({ from: () => ({ where: () => [] }) }));
    const db = { select } as never;
    await expect(
      enforceSpendCap({ db, integrationId: "c1", principal, cap: undefined }),
    ).resolves.toBeUndefined();
    // Default OFF means we never even hit the ledger.
    expect(select).not.toHaveBeenCalled();
  });

  test("throws SpendCapExceededError when over the configured budget", async () => {
    await expect(
      enforceSpendCap({
        db: sumDb(1200),
        integrationId: "c1",
        principal,
        cap,
      }),
    ).rejects.toBeInstanceOf(SpendCapExceededError);
  });

  test("passes when under the configured budget", async () => {
    await expect(
      enforceSpendCap({ db: sumDb(10), integrationId: "c1", principal, cap }),
    ).resolves.toBeUndefined();
  });
});

describe("recordSpend (append to the shared ledger)", () => {
  test("persists input + output + total tokens for the turn", async () => {
    const { db, captured } = insertDb();
    await recordSpend({
      db,
      integrationId: "ai.openai-compatible.c1",
      principal,
      conversationId: "conv-1",
      model: "gpt-4o-mini",
      usage: { inputTokens: 120, outputTokens: 80 },
    });
    expect(captured).toHaveLength(1);
    const row = captured[0];
    expect(row?.integrationId).toBe("ai.openai-compatible.c1");
    expect(row?.principalKind).toBe("user");
    expect(row?.inputTokens).toBe(120);
    expect(row?.outputTokens).toBe(80);
    expect(row?.totalTokens).toBe(200);
    expect(row?.conversationId).toBe("conv-1");
    expect(row?.model).toBe("gpt-4o-mini");
  });

  test("missing / negative usage coerces to 0 (a provider omitting usage never corrupts the ledger)", async () => {
    const { db, captured } = insertDb();
    await recordSpend({
      db,
      integrationId: "c1",
      principal,
      usage: { inputTokens: Number.NaN, outputTokens: -5 },
    });
    const row = captured[0];
    expect(row?.inputTokens).toBe(0);
    expect(row?.outputTokens).toBe(0);
    expect(row?.totalTokens).toBe(0);
  });
});

describe("SpendCapExceededError", () => {
  test("carries used + cap and a clear budget-exceeded message", () => {
    const err = new SpendCapExceededError(1200, 1000);
    expect(err.used).toBe(1200);
    expect(err.tokenBudget).toBe(1000);
    expect(err.message).toContain("spend/budget exceeded");
    expect(err.name).toBe("SpendCapExceededError");
  });
});
