import { describe, it, expect } from "bun:test";
import { extractRunTraceIds } from "./run-trace-ids";
import type { HealthCheckRun } from "./schemas";

function runWith(result: Record<string, unknown>): HealthCheckRun {
  return {
    id: "run-1",
    configurationId: "cfg-1",
    systemId: "sys-1",
    status: "healthy",
    result,
    timestamp: new Date("2026-07-14T00:00:00Z"),
  };
}

describe("extractRunTraceIds", () => {
  it("collects string traceId fields from collector results, deduplicated", () => {
    const run = runWith({
      metadata: {
        collectors: {
          "entry-1": { statusCode: 200, traceId: "a".repeat(32) },
          "entry-2": { statusCode: 200, traceId: "b".repeat(32) },
          "entry-3": { statusCode: 200, traceId: "a".repeat(32) },
        },
      },
    });
    expect(extractRunTraceIds({ run })).toEqual([
      "a".repeat(32),
      "b".repeat(32),
    ]);
  });

  it("ignores collectors without a usable traceId", () => {
    const run = runWith({
      metadata: {
        collectors: {
          none: { statusCode: 200 },
          empty: { traceId: "" },
          wrongType: { traceId: 42 },
          notARecord: "plain string",
          nullish: null,
        },
      },
    });
    expect(extractRunTraceIds({ run })).toEqual([]);
  });

  it("returns empty for runs without collectors metadata", () => {
    expect(extractRunTraceIds({ run: runWith({}) })).toEqual([]);
    expect(extractRunTraceIds({ run: runWith({ metadata: {} }) })).toEqual([]);
    expect(
      extractRunTraceIds({ run: runWith({ metadata: { collectors: [] } }) }),
    ).toEqual([]);
    expect(
      extractRunTraceIds({ run: runWith({ metadata: "not an object" }) }),
    ).toEqual([]);
  });
});
