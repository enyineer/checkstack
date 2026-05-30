import { describe, expect, it } from "bun:test";
import { parseCondition } from "../parser";
import { evaluate, evaluateBoolean } from "../renderer";
import { createDefaultFilterRegistry } from "../filters";

const registry = createDefaultFilterRegistry();

function evalExpr(src: string, scope: Record<string, unknown>): unknown {
  return evaluate(parseCondition(src), scope, { filters: registry });
}

function evalBool(src: string, scope: Record<string, unknown>): boolean {
  return evaluateBoolean(parseCondition(src), scope, { filters: registry });
}

describe("minutes / hours filters", () => {
  it("minutes converts a number to milliseconds", () => {
    expect(evalExpr("30 | minutes", {})).toBe(30 * 60_000);
  });

  it("hours converts a number to milliseconds", () => {
    expect(evalExpr("2 | hours", {})).toBe(2 * 3_600_000);
  });

  it("minutes coerces numeric strings", () => {
    expect(evalExpr('"15" | minutes', {})).toBe(15 * 60_000);
  });

  it("minutes passes through non-numeric input as NaN-safe 0", () => {
    expect(evalExpr('"abc" | minutes', {})).toBe(0);
  });
});

describe("duration_since filter", () => {
  it("returns ms elapsed since the given ISO timestamp", () => {
    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    const ms = evalExpr("ts | duration_since", { ts: since });
    expect(typeof ms).toBe("number");
    // ~5 minutes, allow a small execution window
    expect(ms as number).toBeGreaterThanOrEqual(5 * 60_000 - 1000);
    expect(ms as number).toBeLessThanOrEqual(5 * 60_000 + 5000);
  });

  it("returns 0 for null / undefined (fail-safe, not negative)", () => {
    expect(evalExpr("missing | duration_since", {})).toBe(0);
    expect(evalExpr("ts | duration_since", { ts: null })).toBe(0);
  });

  it("returns 0 for an unparseable value", () => {
    expect(evalExpr("ts | duration_since", { ts: "not-a-date" })).toBe(0);
  });

  it("accepts a Date instance", () => {
    const since = new Date(Date.now() - 60_000);
    const ms = evalExpr("ts | duration_since", { ts: since });
    expect(ms as number).toBeGreaterThanOrEqual(60_000 - 1000);
  });
});

describe("older_than filter", () => {
  it("is true when the timestamp is older than the threshold", () => {
    const since = new Date(Date.now() - 31 * 60_000).toISOString();
    expect(evalBool("ts | older_than(30 | minutes)", { ts: since })).toBe(true);
  });

  it("is false when the timestamp is newer than the threshold", () => {
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    expect(evalBool("ts | older_than(30 | minutes)", { ts: since })).toBe(
      false,
    );
  });

  it("is false (fail-safe) for null / unknown timestamps", () => {
    expect(evalBool("missing | older_than(30 | minutes)", {})).toBe(false);
    expect(evalBool("ts | older_than(30 | minutes)", { ts: null })).toBe(false);
  });

  it("composes in a realistic dwell condition", () => {
    const since = new Date(Date.now() - 45 * 60_000).toISOString();
    const scope = {
      health: { system: { status: "unhealthy", in_status_since: since } },
    };
    const expr =
      "health.system.status == 'unhealthy' && (health.system.in_status_since | older_than(30 | minutes))";
    expect(evalBool(expr, scope)).toBe(true);
  });
});
