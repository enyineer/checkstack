import { describe, it, expect } from "bun:test";
import {
  aggregatedAverage,
  aggregatedRate,
  aggregatedCounter,
  aggregatedMinMax,
  buildAggregatedResultSchema,
} from "./aggregated-result";
import { getHealthResultMeta } from "@checkstack/healthcheck-common";

describe("aggregatedAverage", () => {
  it("creates field with correct type and merge function", () => {
    const field = aggregatedAverage({
      "x-chart-type": "line",
      "x-chart-label": "Avg Response Time",
    });

    expect(field.type).toBe("average");
    expect(field.meta["x-chart-label"]).toBe("Avg Response Time");
  });

  it("mergeStates correctly merges two average states", () => {
    const field = aggregatedAverage({});
    const merged = field.mergeStates(
      { _sum: 100, _count: 2, avg: 50 },
      { _sum: 200, _count: 2, avg: 100 },
    );
    expect(merged).toEqual({ _type: "average", _sum: 300, _count: 4, avg: 75 });
  });

  it("getDisplayValue returns avg", () => {
    const field = aggregatedAverage({});
    expect(field.getDisplayValue({ _sum: 100, _count: 2, avg: 50 })).toBe(50);
  });
});

describe("aggregatedRate", () => {
  it("creates field with correct type", () => {
    const field = aggregatedRate({
      "x-chart-type": "gauge",
      "x-chart-label": "Success Rate",
    });

    expect(field.type).toBe("rate");
  });

  it("mergeStates correctly merges two rate states", () => {
    const field = aggregatedRate({});
    const merged = field.mergeStates(
      { _success: 3, _total: 4, rate: 75 },
      { _success: 7, _total: 10, rate: 70 },
    );
    expect(merged.rate).toBe(71);
  });

  it("getDisplayValue returns rate", () => {
    const field = aggregatedRate({});
    expect(field.getDisplayValue({ _success: 5, _total: 10, rate: 50 })).toBe(
      50,
    );
  });
});

describe("aggregatedCounter", () => {
  it("creates field with correct type", () => {
    const field = aggregatedCounter({
      "x-chart-type": "counter",
    });

    expect(field.type).toBe("counter");
  });

  it("mergeStates correctly merges two counter states", () => {
    const field = aggregatedCounter({});
    const merged = field.mergeStates({ count: 5 }, { count: 3 });
    expect(merged).toEqual({ _type: "counter", count: 8 });
  });
});

describe("aggregatedMinMax", () => {
  it("creates field with correct type", () => {
    const field = aggregatedMinMax({
      "x-chart-type": "line",
    });

    expect(field.type).toBe("minmax");
  });

  it("mergeStates correctly merges two minmax states", () => {
    const field = aggregatedMinMax({});
    const merged = field.mergeStates(
      { min: 10, max: 50 },
      { min: 5, max: 100 },
    );
    expect(merged).toEqual({ _type: "minmax", min: 5, max: 100 });
  });
});

describe("buildAggregatedResultSchema", () => {
  it("creates schema with field keys mapping to state types", () => {
    const { schema } = buildAggregatedResultSchema({
      avgResponseTimeMs: aggregatedAverage({}),
      successRate: aggregatedRate({}),
    });

    // Should parse valid data with _type - field keys now map directly to state objects
    const result = schema.parse({
      avgResponseTimeMs: { _type: "average", _sum: 100, _count: 1, avg: 100 },
      successRate: { _type: "rate", _success: 95, _total: 100, rate: 95 },
    });

    expect(result.avgResponseTimeMs.avg).toBe(100);
    expect(result.successRate.rate).toBe(95);
  });

  it("mergeAggregatedResults correctly merges two results", () => {
    const { mergeAggregatedResults } = buildAggregatedResultSchema({
      avgResponseTimeMs: aggregatedAverage({}),
      successRate: aggregatedRate({}),
    });

    const a = {
      avgResponseTimeMs: {
        _type: "average" as const,
        _sum: 100,
        _count: 2,
        avg: 50,
      },
      successRate: {
        _type: "rate" as const,
        _success: 3,
        _total: 4,
        rate: 75,
      },
    };

    const b = {
      avgResponseTimeMs: {
        _type: "average" as const,
        _sum: 200,
        _count: 2,
        avg: 100,
      },
      successRate: {
        _type: "rate" as const,
        _success: 7,
        _total: 10,
        rate: 70,
      },
    };

    const merged = mergeAggregatedResults(a, b);

    // Average: (100 + 200) / 4 = 75
    expect(merged.avgResponseTimeMs.avg).toBe(75);
    expect(merged.avgResponseTimeMs).toEqual({
      _type: "average",
      _sum: 300,
      _count: 4,
      avg: 75,
    });

    // Rate: 10/14 ≈ 71%
    expect(merged.successRate.rate).toBe(71);
    expect(merged.successRate).toEqual({
      _type: "rate",
      _success: 10,
      _total: 14,
      rate: 71,
    });
  });

  it("mergeAggregatedResults handles undefined first argument", () => {
    const { mergeAggregatedResults } = buildAggregatedResultSchema({
      avgResponseTimeMs: aggregatedAverage({}),
    });

    const b = {
      avgResponseTimeMs: {
        _type: "average" as const,
        _sum: 100,
        _count: 1,
        avg: 100,
      },
    };

    const merged = mergeAggregatedResults(undefined, b);

    expect(merged.avgResponseTimeMs.avg).toBe(100);
    expect(merged.avgResponseTimeMs).toEqual({
      _type: "average",
      _sum: 100,
      _count: 1,
      avg: 100,
    });
  });
});

describe("chart metadata registration", () => {
  it("aggregatedAverage schema has chart metadata registered", () => {
    const field = aggregatedAverage({
      "x-chart-type": "line",
      "x-chart-label": "Avg Response Time",
      "x-chart-unit": "ms",
    });

    // The stateSchema should have metadata registered via healthResultRegistry
    // We can verify by checking that the schema is registered
    const meta = getHealthResultMeta(field.stateSchema);

    expect(meta).toBeDefined();
    expect(meta?.["x-chart-type"]).toBe("line");
    expect(meta?.["x-chart-label"]).toBe("Avg Response Time");
    expect(meta?.["x-chart-unit"]).toBe("ms");
  });

  it("aggregatedRate schema has chart metadata registered", () => {
    const field = aggregatedRate({
      "x-chart-type": "gauge",
      "x-chart-label": "Success Rate",
      "x-chart-unit": "%",
    });

    const meta = getHealthResultMeta(field.stateSchema);

    expect(meta).toBeDefined();
    expect(meta?.["x-chart-type"]).toBe("gauge");
    expect(meta?.["x-chart-label"]).toBe("Success Rate");
  });

  it("aggregatedCounter schema has chart metadata registered", () => {
    const field = aggregatedCounter({
      "x-chart-type": "counter",
      "x-chart-label": "Error Count",
    });

    const meta = getHealthResultMeta(field.stateSchema);

    expect(meta).toBeDefined();
    expect(meta?.["x-chart-type"]).toBe("counter");
    expect(meta?.["x-chart-label"]).toBe("Error Count");
  });

  it("aggregatedMinMax schema has chart metadata registered", () => {
    const field = aggregatedMinMax({
      "x-chart-type": "line",
      "x-chart-label": "Latency Range",
    });

    const meta = getHealthResultMeta(field.stateSchema);

    expect(meta).toBeDefined();
    expect(meta?.["x-chart-type"]).toBe("line");
    expect(meta?.["x-chart-label"]).toBe("Latency Range");
  });

  it("each field instance has unique metadata", () => {
    const field1 = aggregatedAverage({
      "x-chart-type": "line",
      "x-chart-label": "First Field",
    });

    const field2 = aggregatedAverage({
      "x-chart-type": "gauge",
      "x-chart-label": "Second Field",
    });

    const meta1 = getHealthResultMeta(field1.stateSchema);
    const meta2 = getHealthResultMeta(field2.stateSchema);

    // Each field should have its own metadata
    expect(meta1?.["x-chart-label"]).toBe("First Field");
    expect(meta2?.["x-chart-label"]).toBe("Second Field");
    expect(meta1?.["x-chart-type"]).toBe("line");
    expect(meta2?.["x-chart-type"]).toBe("gauge");
  });
});
