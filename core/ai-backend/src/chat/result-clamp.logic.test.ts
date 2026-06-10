import { describe, test, expect } from "bun:test";
import {
  clampToolResult,
  MAX_TOOL_RESULT_CHARS,
} from "./result-clamp.logic";

/** Build a runs-shaped result with `n` verbose run rows. */
function runsResult(n: number) {
  const runs = Array.from({ length: n }, (_, i) => ({
    id: `run-${i}-0000-0000-0000-000000000000`,
    configurationId: "cfg-1111-2222-3333-444455556666",
    systemId: "sys-aaaa-bbbb-cccc-ddddeeeeffff",
    status: i % 3 === 0 ? "unhealthy" : "healthy",
    timestamp: "2026-06-10T12:00:00.000Z",
    latencyMs: 123 + i,
    sourceLabel: "EU West (eu-west-1)",
  }));
  return { runs, total: n };
}

describe("clampToolResult", () => {
  test("passes through a small result untouched", () => {
    const result = runsResult(3);
    const out = clampToolResult({ result });
    expect(out.clamped).toBe(false);
    expect(out.value).toBe(result);
  });

  test("trims the largest array and attaches a _truncated note", () => {
    const result = runsResult(2000);
    const out = clampToolResult({ result, maxChars: 4000 });
    expect(out.clamped).toBe(true);
    const value = out.value as {
      runs: unknown[];
      total: number;
      _truncated: { fields: Array<{ field: string; kept: number; omitted: number }>; hint: string };
    };
    // Stays within budget.
    expect(JSON.stringify(value).length).toBeLessThanOrEqual(4000);
    // Kept the head, dropped the rest, and reported it.
    expect(value.runs.length).toBeGreaterThan(0);
    expect(value.runs.length).toBeLessThan(2000);
    expect(value.total).toBe(2000); // scalar siblings preserved
    const tr = value._truncated.fields.find((f) => f.field === "runs");
    expect(tr).toBeDefined();
    expect(tr?.kept).toBe(value.runs.length);
    expect(tr?.omitted).toBe(2000 - value.runs.length);
    expect(value._truncated.hint).toContain("Narrow");
  });

  test("wraps a bare oversized array as { items, _truncated }", () => {
    const arr = Array.from({ length: 5000 }, (_, i) => ({
      k: `value-${i}-padding-padding-padding-padding`,
    }));
    const out = clampToolResult({ result: arr, maxChars: 3000 });
    expect(out.clamped).toBe(true);
    const value = out.value as {
      items: unknown[];
      _truncated: { fields: Array<{ omitted: number }> };
    };
    expect(Array.isArray(value.items)).toBe(true);
    expect(value.items.length).toBeLessThan(5000);
    expect(JSON.stringify(value).length).toBeLessThanOrEqual(3000);
  });

  test("returns a preview envelope when nothing array-shaped can be trimmed", () => {
    const huge = { blob: "x".repeat(50_000) };
    const out = clampToolResult({ result: huge, maxChars: 1000 });
    expect(out.clamped).toBe(true);
    const value = out.value as {
      _truncated: { note: string; omittedChars: number };
      preview: string;
    };
    expect(value.preview.length).toBeLessThanOrEqual(1000);
    expect(value._truncated.omittedChars).toBeGreaterThan(0);
  });

  test("passes through an unserializable result rather than throwing", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const out = clampToolResult({ result: circular });
    expect(out.clamped).toBe(false);
    expect(out.value).toBe(circular);
  });

  test("default budget is the exported constant", () => {
    // A result just under the default budget is untouched.
    const result = runsResult(5);
    expect(JSON.stringify(result).length).toBeLessThan(MAX_TOOL_RESULT_CHARS);
    expect(clampToolResult({ result }).clamped).toBe(false);
  });
});
