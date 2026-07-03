import { describe, expect, test } from "bun:test";
import {
  ASSERTION_ACTUAL_MAX_LENGTH,
  AssertionOutcomeSchema,
  computeAssertionKey,
  foldOutcomesIntoStats,
  mergeAssertionStats,
  parseAssertionKey,
  readAssertionStats,
  truncateActual,
  type AssertionOutcome,
} from "./assertion-analytics";

function outcome(overrides: Partial<AssertionOutcome>): AssertionOutcome {
  return {
    key: computeAssertionKey({
      assertion: { field: "statusCode", operator: "equals", value: 200 },
    }),
    field: "statusCode",
    operator: "equals",
    value: "200",
    passed: true,
    ...overrides,
  };
}

describe("computeAssertionKey / parseAssertionKey", () => {
  test("round-trips the full identity", () => {
    const key = computeAssertionKey({
      assertion: {
        field: "body.$",
        jsonPath: "$.status",
        operator: "equals",
        value: "ok",
      },
    });
    expect(parseAssertionKey({ key })).toEqual({
      field: "body.$",
      jsonPath: "$.status",
      operator: "equals",
      value: "ok",
    });
  });

  test("value-less and path-less assertions encode nulls", () => {
    const key = computeAssertionKey({
      assertion: { field: "valid", operator: "isTrue" },
    });
    expect(parseAssertionKey({ key })).toEqual({
      field: "valid",
      operator: "isTrue",
    });
  });

  test("identity is stable: same parts, same key; changed parts, new key", () => {
    const a = computeAssertionKey({
      assertion: { field: "statusCode", operator: "equals", value: 200 },
    });
    const b = computeAssertionKey({
      assertion: { field: "statusCode", operator: "equals", value: "200" },
    });
    // Numeric vs string expected values stringify identically — same series.
    expect(a).toBe(b);
    const c = computeAssertionKey({
      assertion: { field: "statusCode", operator: "equals", value: 201 },
    });
    expect(c).not.toBe(a);
  });

  test("whitespace-only JSONPath reads as absent", () => {
    const key = computeAssertionKey({
      assertion: { field: "x", jsonPath: "  ", operator: "exists" },
    });
    expect(parseAssertionKey({ key })?.jsonPath).toBeUndefined();
  });

  test("malformed keys parse to undefined", () => {
    expect(parseAssertionKey({ key: "not json" })).toBeUndefined();
    expect(parseAssertionKey({ key: '["too","short"]' })).toBeUndefined();
  });
});

describe("truncateActual", () => {
  test("keeps short values verbatim and stringifies non-strings", () => {
    expect(truncateActual({ value: "ok" })).toBe("ok");
    expect(truncateActual({ value: 200 })).toBe("200");
    expect(truncateActual({ value: { a: 1 } })).toBe('{"a":1}');
  });

  test("caps long values at the limit with an ellipsis", () => {
    const long = "x".repeat(5000);
    const out = truncateActual({ value: long });
    expect(out.length).toBe(ASSERTION_ACTUAL_MAX_LENGTH);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("foldOutcomesIntoStats", () => {
  test("tallies pass/fail per collector entry and assertion key", () => {
    const key = outcome({}).key;
    let stats = foldOutcomesIntoStats({
      stats: undefined,
      collectorEntryId: "uuid-1",
      outcomes: [outcome({ passed: true }), outcome({ passed: false })],
    });
    stats = foldOutcomesIntoStats({
      stats,
      collectorEntryId: "uuid-1",
      outcomes: [outcome({ passed: true })],
    });
    expect(stats["uuid-1"][key]).toEqual({ passCount: 2, failCount: 1 });
  });

  test("does not mutate the input record", () => {
    const initial = foldOutcomesIntoStats({
      stats: undefined,
      collectorEntryId: "uuid-1",
      outcomes: [outcome({ passed: true })],
    });
    const before = JSON.stringify(initial);
    foldOutcomesIntoStats({
      stats: initial,
      collectorEntryId: "uuid-1",
      outcomes: [outcome({ passed: false })],
    });
    expect(JSON.stringify(initial)).toBe(before);
  });
});

describe("mergeAssertionStats", () => {
  const key = outcome({}).key;

  test("merges additively across entries and keys", () => {
    const merged = mergeAssertionStats({
      a: { "uuid-1": { [key]: { passCount: 5, failCount: 1 } } },
      b: {
        "uuid-1": { [key]: { passCount: 2, failCount: 0 } },
        "uuid-2": { [key]: { passCount: 3, failCount: 3 } },
      },
    });
    expect(merged).toEqual({
      "uuid-1": { [key]: { passCount: 7, failCount: 1 } },
      "uuid-2": { [key]: { passCount: 3, failCount: 3 } },
    });
  });

  test("undefined sides pass through", () => {
    const stats = { "uuid-1": { [key]: { passCount: 1, failCount: 0 } } };
    expect(mergeAssertionStats({ a: undefined, b: stats })).toBe(stats);
    expect(mergeAssertionStats({ a: stats, b: undefined })).toBe(stats);
    expect(mergeAssertionStats({ a: undefined, b: undefined })).toBeUndefined();
  });
});

describe("readAssertionStats", () => {
  const key = outcome({}).key;

  test("reads validated stats from an aggregatedResult", () => {
    expect(
      readAssertionStats({
        aggregatedResult: {
          collectors: {},
          assertions: { "uuid-1": { [key]: { passCount: 4, failCount: 0 } } },
        },
      }),
    ).toEqual({ "uuid-1": { [key]: { passCount: 4, failCount: 0 } } });
  });

  test("absent or malformed stats read as undefined (pre-feature buckets)", () => {
    expect(readAssertionStats({ aggregatedResult: {} })).toBeUndefined();
    expect(readAssertionStats({ aggregatedResult: undefined })).toBeUndefined();
    expect(
      readAssertionStats({
        aggregatedResult: { assertions: { "uuid-1": "garbage" } },
      }),
    ).toBeUndefined();
  });
});

describe("AssertionOutcomeSchema", () => {
  test("parses a full outcome and rejects missing identity", () => {
    expect(
      AssertionOutcomeSchema.safeParse(
        outcome({ passed: false, actual: "404", message: "expected 200" }),
      ).success,
    ).toBe(true);
    expect(
      AssertionOutcomeSchema.safeParse({ passed: true }).success,
    ).toBe(false);
  });
});
