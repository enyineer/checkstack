import { describe, test, expect } from "bun:test";
import { planCompaction, type CompactionRow } from "./compaction.logic";

const rows = (...tokens: number[]): CompactionRow[] =>
  tokens.map((t, i) => ({ id: `r${i}`, tokens: t }));

describe("planCompaction", () => {
  test("keeps everything when already under budget", () => {
    const plan = planCompaction({
      rows: rows(100, 100, 100),
      fixedTokens: 200,
      budgetTokens: 1000,
    });
    expect(plan.needsSummary).toBe(false);
    expect(plan.summarizeRowIds).toEqual([]);
    expect(plan.keepRowIds).toEqual(["r0", "r1", "r2"]);
  });

  test("summarizes oldest rows until the kept tail fits", () => {
    // fixed 100 + rows; budget 350. Keep newest rows whose sum + fixed <= 350.
    const plan = planCompaction({
      rows: rows(200, 200, 200, 100),
      fixedTokens: 100,
      budgetTokens: 350,
    });
    expect(plan.needsSummary).toBe(true);
    // Drops oldest until 100 + sum(keep) <= 350: keep [200,100]=300 -> 400 >350,
    // keep [100]=100 -> 200 <=350. So summarize r0,r1,r2; keep r3.
    expect(plan.summarizeRowIds).toEqual(["r0", "r1", "r2"]);
    expect(plan.keepRowIds).toEqual(["r3"]);
  });

  test("always keeps the most recent row even if it alone exceeds budget", () => {
    const plan = planCompaction({
      rows: rows(100, 100, 5000),
      fixedTokens: 100,
      budgetTokens: 500,
    });
    expect(plan.keepRowIds).toEqual(["r2"]);
    expect(plan.summarizeRowIds).toEqual(["r0", "r1"]);
    expect(plan.needsSummary).toBe(true);
  });

  test("single row is always kept, never summarized", () => {
    const plan = planCompaction({
      rows: rows(9999),
      fixedTokens: 100,
      budgetTokens: 500,
    });
    expect(plan.keepRowIds).toEqual(["r0"]);
    expect(plan.summarizeRowIds).toEqual([]);
    expect(plan.needsSummary).toBe(false);
  });

  test("empty rows -> nothing to do", () => {
    const plan = planCompaction({ rows: [], fixedTokens: 100, budgetTokens: 500 });
    expect(plan.keepRowIds).toEqual([]);
    expect(plan.summarizeRowIds).toEqual([]);
    expect(plan.needsSummary).toBe(false);
  });
});
