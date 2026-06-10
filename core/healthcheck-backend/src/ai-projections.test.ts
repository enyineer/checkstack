import { describe, test, expect } from "bun:test";
import { projectRunHistoryForModel } from "./ai-projections";

describe("projectRunHistoryForModel", () => {
  test("trims each run to time/status/latency/source and keeps total", () => {
    const ts = new Date("2026-06-10T12:00:00.000Z");
    const out = projectRunHistoryForModel({
      runs: [
        {
          id: "run-1",
          configurationId: "cfg-1",
          systemId: "sys-1",
          environmentId: "env-1",
          sourceId: "src-1",
          status: "unhealthy",
          timestamp: ts,
          latencyMs: 142,
          sourceLabel: "EU West",
        },
      ],
      total: 57,
    }) as {
      runs: Array<Record<string, unknown>>;
      returned: number;
      total: number;
    };

    expect(out.total).toBe(57);
    expect(out.returned).toBe(1);
    expect(out.runs).toHaveLength(1);
    // Kept the useful fields...
    expect(out.runs[0]).toEqual({
      timestamp: "2026-06-10T12:00:00.000Z",
      status: "unhealthy",
      latencyMs: 142,
      sourceLabel: "EU West",
    });
    // ...and dropped the opaque ids.
    expect(out.runs[0]).not.toHaveProperty("id");
    expect(out.runs[0]).not.toHaveProperty("configurationId");
    expect(out.runs[0]).not.toHaveProperty("systemId");
  });

  test("omits absent optional fields", () => {
    const out = projectRunHistoryForModel({
      runs: [{ status: "healthy", timestamp: "2026-06-10T12:00:00.000Z" }],
      total: 1,
    }) as { runs: Array<Record<string, unknown>> };
    expect(out.runs[0]).toEqual({
      timestamp: "2026-06-10T12:00:00.000Z",
      status: "healthy",
    });
  });

  test("returns the input unchanged when the shape is unexpected", () => {
    const weird = { foo: "bar" };
    expect(projectRunHistoryForModel(weird)).toBe(weird);
  });
});
