import { describe, expect, test, mock } from "bun:test";
import {
  checkToolBudget,
  enforceToolBudget,
  ToolBudgetExceededError,
  TOOL_BUDGET_MAX_CALLS,
} from "./tool-budget";

/** Build a fake db whose count query resolves to `value`. */
function dbReturning(value: number) {
  const where = mock(() => Promise.resolve([{ value }]));
  const from = mock(() => ({ where }));
  const select = mock(() => ({ from }));
  return { db: { select } as never, where };
}

describe("per-principal tool budget (§14.5, P3 review item 3)", () => {
  test("under budget is allowed; the count is read over a trailing window", async () => {
    const { db, where } = dbReturning(5);
    const now = new Date("2026-06-01T00:01:00Z");
    const result = await checkToolBudget({
      db,
      principal: { kind: "user", id: "u1" },
      max: 10,
      windowMs: 60_000,
      now,
    });
    expect(result.used).toBe(5);
    expect(result.allowed).toBe(true);
    // Rolling window: start is `now - windowMs`.
    expect(result.windowStart.getTime()).toBe(now.getTime() - 60_000);
    expect(where).toHaveBeenCalledTimes(1);
  });

  test("at-or-over budget is refused (used >= max)", async () => {
    const { db } = dbReturning(10);
    const result = await checkToolBudget({
      db,
      principal: { kind: "user", id: "u1" },
      max: 10,
    });
    expect(result.allowed).toBe(false);
  });

  test("enforceToolBudget throws ToolBudgetExceededError over budget", async () => {
    const { db } = dbReturning(TOOL_BUDGET_MAX_CALLS);
    await expect(
      enforceToolBudget({ db, principal: { kind: "application", id: "a1" } }),
    ).rejects.toBeInstanceOf(ToolBudgetExceededError);
  });

  test("enforceToolBudget passes under budget", async () => {
    const { db } = dbReturning(0);
    await expect(
      enforceToolBudget({ db, principal: { kind: "user", id: "u1" } }),
    ).resolves.toBeUndefined();
  });
});
