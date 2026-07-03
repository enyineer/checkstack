import { describe, expect, test } from "bun:test";
import type { AnomalyBaselineDto } from "@checkstack/anomaly-common";
import type { ChartField } from "./schema-parser";
import {
  buildAssertionTileModels,
  buildTileModels,
  formatMetricValue,
  gaugeTone,
  orderTiles,
  type TileBucket,
  type TileModel,
} from "./tile-model.logic";
import { computeAssertionKey } from "@checkstack/healthcheck-common";
import { labelForAssertionKey } from "../components/assertion-display.logic";

const INSTANCE = "abc-123";

function field(overrides: Partial<ChartField> & { name: string }): ChartField {
  return {
    chartType: "line",
    label: overrides.name,
    schemaType: "number",
    collectorId: INSTANCE ? "healthcheck.http" : undefined,
    priority: 100,
    ...overrides,
  };
}

function bucket({
  hour,
  fields,
}: {
  hour: number;
  fields: Record<string, unknown>;
}): TileBucket {
  const start = Date.UTC(2026, 6, 1, hour);
  return {
    bucketStart: new Date(start),
    bucketEnd: new Date(start + 3_600_000),
    runCount: 10,
    aggregatedResult: { collectors: { [INSTANCE]: fields } },
  };
}

function baseline(overrides: Partial<AnomalyBaselineDto>): AnomalyBaselineDto {
  return {
    id: "b1",
    systemId: "sys",
    configurationId: "cfg",
    environmentId: null,
    fieldPath: "latencyMs",
    mean: 100,
    stdDev: 30,
    trendSlope: 0,
    sampleCount: 100,
    computedAt: "2026-07-01T00:00:00Z",
    dominantValue: null,
    dominantRatio: null,
    ...overrides,
  };
}

describe("buildTileModels: number tiles", () => {
  const buckets = [
    bucket({ hour: 0, fields: { responseTime: 100 } }),
    bucket({ hour: 1, fields: { responseTime: 120 } }),
    bucket({ hour: 2, fields: { responseTime: 150 } }),
  ];

  test("line fields lead with the latest value and carry a series", () => {
    const [tile] = buildTileModels({
      fields: [
        field({ name: "responseTime", chartType: "line", unit: "ms" }),
      ],
      buckets,
      baselines: [],
      instanceKey: INSTANCE,
    });
    expect(tile.latestText).toBe("150ms");
    expect(tile.kind).toBe("number");
    expect(tile.sparkValues).toEqual([100, 120, 150]);
    expect(tile.series?.length).toBe(3);
    expect(tile.expandable).toBe(true);
  });

  test("delta compares the last two buckets and honors goodDirection", () => {
    const [tile] = buildTileModels({
      fields: [
        field({
          name: "responseTime",
          chartType: "line",
          unit: "ms",
          goodDirection: "down",
        }),
      ],
      buckets,
      baselines: [],
      instanceKey: INSTANCE,
    });
    expect(tile.delta).toEqual({
      direction: "up",
      text: "+30ms",
      sentiment: "bad",
    });
  });

  test("counter fields lead with the window total", () => {
    const [tile] = buildTileModels({
      fields: [field({ name: "errorCount", chartType: "counter" })],
      buckets: [
        bucket({ hour: 0, fields: { errorCount: 2 } }),
        bucket({ hour: 1, fields: { errorCount: 5 } }),
      ],
      baselines: [],
      instanceKey: INSTANCE,
    });
    expect(tile.latestText).toBe("7");
    expect(tile.delta).toBeUndefined();
  });

  test("baseline produces Expected chips and an expected band", () => {
    const [tile] = buildTileModels({
      fields: [
        field({ name: "responseTime", chartType: "line", unit: "ms" }),
      ],
      buckets,
      baselines: [
        baseline({
          fieldPath: `collectors.healthcheck.http.responseTime`,
          mean: 110,
          stdDev: 30,
        }),
      ],
      instanceKey: INSTANCE,
    });
    // runCount 10 per bucket => spread = 30/sqrt(10)*3 ≈ 28.5
    expect(tile.baselineChips?.expected).toBe("Expected: 110.0ms (±28.5)");
    expect(tile.expectedBand?.mean).toBe(110);
  });

  test("fields with no numeric data stay em-dash and non-expandable", () => {
    const [tile] = buildTileModels({
      fields: [field({ name: "missing", chartType: "line" })],
      buckets,
      baselines: [],
      instanceKey: INSTANCE,
    });
    expect(tile.latestText).toBe("—");
    expect(tile.expandable).toBe(false);
  });
});

describe("buildTileModels: gauge tiles", () => {
  test("leads with the LATEST bucket value (not a sum) and clamps", () => {
    const [tile] = buildTileModels({
      fields: [field({ name: "successRate", chartType: "gauge", unit: "%" })],
      buckets: [
        bucket({ hour: 0, fields: { successRate: 98 } }),
        bucket({ hour: 1, fields: { successRate: 94 } }),
      ],
      baselines: [],
      instanceKey: INSTANCE,
    });
    // The legacy renderer SUMMED bucket values (98+94 clamped to 100); the
    // tile leads with the latest bucket's rate.
    expect(tile.latestText).toBe("94%");
    expect(tile.gaugeFraction).toBeCloseTo(0.94, 5);
    expect(tile.tone).toBe("ok");
  });

  test("tone thresholds honor goodDirection", () => {
    expect(gaugeTone({ value: 95 })).toBe("ok");
    expect(gaugeTone({ value: 75 })).toBe("warn");
    expect(gaugeTone({ value: 50 })).toBe("down");
    expect(gaugeTone({ value: 5, goodDirection: "down" })).toBe("ok");
    expect(gaugeTone({ value: 20, goodDirection: "down" })).toBe("warn");
    expect(gaugeTone({ value: 50, goodDirection: "down" })).toBe("down");
  });
});

describe("buildTileModels: distribution tiles", () => {
  test("sums pre-aggregated records across buckets and leads with the top slice", () => {
    const [tile] = buildTileModels({
      fields: [field({ name: "statusCodeCounts", chartType: "pie" })],
      buckets: [
        bucket({ hour: 0, fields: { statusCodeCounts: { "200": 50, "404": 2 } } }),
        bucket({ hour: 1, fields: { statusCodeCounts: { "200": 46, "500": 2 } } }),
      ],
      baselines: [],
      instanceKey: INSTANCE,
    });
    expect(tile.kind).toBe("distribution");
    expect(tile.slices).toEqual([
      { id: "200", label: "200", value: 96 },
      { id: "404", label: "404", value: 2 },
      { id: "500", label: "500", value: 2 },
    ]);
    expect(tile.latestText).toBe("200 · 96%");
  });

  test("simple values fall back to occurrence counting", () => {
    const [tile] = buildTileModels({
      fields: [field({ name: "statusCode", chartType: "bar" })],
      buckets: [
        bucket({ hour: 0, fields: { statusCode: 200 } }),
        bucket({ hour: 1, fields: { statusCode: 200 } }),
        bucket({ hour: 2, fields: { statusCode: 500 } }),
      ],
      baselines: [],
      instanceKey: INSTANCE,
    });
    expect(tile.slices).toEqual([
      { id: "200", label: "200", value: 2 },
      { id: "500", label: "500", value: 1 },
    ]);
  });
});

describe("buildTileModels: boolean tiles", () => {
  test("maps buckets to ok/down cells and summarizes mixed windows", () => {
    const [tile] = buildTileModels({
      fields: [field({ name: "valid", chartType: "boolean" })],
      buckets: [
        bucket({ hour: 0, fields: { valid: true } }),
        bucket({ hour: 1, fields: { valid: false } }),
        bucket({ hour: 2, fields: { valid: true } }),
      ],
      baselines: [],
      instanceKey: INSTANCE,
    });
    expect(tile.boolCells?.map((c) => c.status)).toEqual(["ok", "down", "ok"]);
    expect(tile.latestText).toBe("Yes · 67% yes");
    expect(tile.tone).toBe("ok");
  });

  test("uniform windows show just the value", () => {
    const [tile] = buildTileModels({
      fields: [field({ name: "valid", chartType: "boolean" })],
      buckets: [bucket({ hour: 0, fields: { valid: false } })],
      baselines: [],
      instanceKey: INSTANCE,
    });
    expect(tile.latestText).toBe("No");
    expect(tile.tone).toBe("down");
  });
});

describe("buildTileModels: category and status tiles", () => {
  test("category tiles flag non-uniform history with the warn tone", () => {
    const [tile] = buildTileModels({
      fields: [field({ name: "role", chartType: "text" })],
      buckets: [
        bucket({ hour: 0, fields: { role: "primary" } }),
        bucket({ hour: 1, fields: { role: "replica" } }),
        bucket({ hour: 2, fields: { role: "primary" } }),
      ],
      baselines: [],
      instanceKey: INSTANCE,
    });
    expect(tile.kind).toBe("category");
    expect(tile.latestText).toBe("primary");
    expect(tile.tone).toBe("warn");
    expect(tile.categoryCells?.length).toBe(3);
  });

  test("status tiles read No errors when empty and down when set", () => {
    const clean = buildTileModels({
      fields: [field({ name: "error", chartType: "status" })],
      buckets: [bucket({ hour: 0, fields: {} })],
      baselines: [],
      instanceKey: INSTANCE,
    })[0];
    expect(clean.latestText).toBe("No errors");
    expect(clean.tone).toBe("default");
    expect(clean.expandable).toBe(false);

    const failing = buildTileModels({
      fields: [field({ name: "error", chartType: "status" })],
      buckets: [bucket({ hour: 0, fields: { error: "connect timeout" } })],
      baselines: [],
      instanceKey: INSTANCE,
    })[0];
    expect(failing.latestText).toBe("connect timeout");
    expect(failing.tone).toBe("down");
  });
});

describe("buildTileModels: aggregated _type unwrapping", () => {
  test("average/rate reductions unwrap through getFieldValue", () => {
    const [tile] = buildTileModels({
      fields: [field({ name: "responseTime", chartType: "line", unit: "ms" })],
      buckets: [
        bucket({
          hour: 0,
          fields: {
            responseTime: { _type: "average", avg: 105, sum: 1050, count: 10 },
          },
        }),
      ],
      baselines: [],
      instanceKey: INSTANCE,
    });
    expect(tile.latestText).toBe("105ms");
  });
});

describe("orderTiles", () => {
  test("orders by priority, keeping schema order for ties", () => {
    const t = (key: string, priority: number): TileModel => ({
      key,
      fieldName: key,
      label: key,
      unit: "",
      kind: "number",
      priority,
      latestText: "1",
      tone: "default",
      expandable: false,
    });
    const ordered = orderTiles({
      tiles: [t("c", 100), t("a", 10), t("b", 100), t("z", 20)],
    });
    expect(ordered.map((x) => x.key)).toEqual(["a", "z", "c", "b"]);
  });
});

describe("formatMetricValue", () => {
  test("whole numbers plain, fractions one decimal", () => {
    expect(formatMetricValue({ value: 150, unit: "ms" })).toBe("150ms");
    expect(formatMetricValue({ value: 0.9666, unit: "%" })).toBe("1.0%");
    expect(formatMetricValue({ value: 12.34 })).toBe("12.3");
  });
});

describe("buildAssertionTileModels", () => {
  const KEY = computeAssertionKey({
    assertion: { field: "statusCode", operator: "equals", value: 200 },
  });
  const OLD_KEY = computeAssertionKey({
    assertion: { field: "statusCode", operator: "equals", value: 201 },
  });
  const labelForKey = ({ key }: { key: string }) =>
    labelForAssertionKey({ key });

  function assertionBucket({
    hour,
    counts,
  }: {
    hour: number;
    counts?: Record<string, { passCount: number; failCount: number }>;
  }): TileBucket {
    const start = Date.UTC(2026, 6, 1, hour);
    return {
      bucketStart: new Date(start),
      bucketEnd: new Date(start + 3_600_000),
      runCount: 10,
      aggregatedResult:
        counts === undefined
          ? { collectors: {} }
          : { collectors: {}, assertions: { [INSTANCE]: counts } },
    };
  }

  test("builds a pass-rate tile with per-bucket sparkline and stacks", () => {
    const [tile] = buildAssertionTileModels({
      buckets: [
        assertionBucket({
          hour: 0,
          counts: { [KEY]: { passCount: 58, failCount: 2 } },
        }),
        assertionBucket({
          hour: 1,
          counts: { [KEY]: { passCount: 60, failCount: 0 } },
        }),
      ],
      instanceKey: INSTANCE,
      configuredKeys: [KEY],
      labelForKey,
    });
    expect(tile.label).toBe("statusCode equals 200");
    // 118 of 120 => 98.3%.
    expect(tile.latestText).toBe("98.3% pass");
    expect(tile.sparkValues).toEqual([96.7, 100]);
    expect(tile.stacked[0]).toMatchObject({ counts: { ok: 58, down: 2 } });
    // Failures in the window but the latest bucket is clean => warn.
    expect(tile.tone).toBe("warn");
    expect(tile.configured).toBe(true);
  });

  test("latest bucket failing reads down; all passing reads ok", () => {
    const failingNow = buildAssertionTileModels({
      buckets: [
        assertionBucket({
          hour: 0,
          counts: { [KEY]: { passCount: 60, failCount: 1 } },
        }),
      ],
      instanceKey: INSTANCE,
      configuredKeys: [KEY],
      labelForKey,
    })[0];
    expect(failingNow.tone).toBe("down");

    const clean = buildAssertionTileModels({
      buckets: [
        assertionBucket({
          hour: 0,
          counts: { [KEY]: { passCount: 60, failCount: 0 } },
        }),
      ],
      instanceKey: INSTANCE,
      configuredKeys: [KEY],
      labelForKey,
    })[0];
    expect(clean.tone).toBe("ok");
  });

  test("configured assertions appear before data exists; historical-only series flagged", () => {
    const tiles = buildAssertionTileModels({
      buckets: [
        assertionBucket({
          hour: 0,
          counts: { [OLD_KEY]: { passCount: 10, failCount: 0 } },
        }),
      ],
      instanceKey: INSTANCE,
      configuredKeys: [KEY],
      labelForKey,
    });
    expect(tiles.length).toBe(2);
    // Configured-but-no-data-yet tile leads with an em-dash.
    expect(tiles[0]).toMatchObject({
      assertionKey: KEY,
      latestText: "—",
      tone: "default",
      configured: true,
    });
    expect(tiles[1]).toMatchObject({
      assertionKey: OLD_KEY,
      configured: false,
    });
  });

  test("pre-feature buckets read as gaps, not zeros", () => {
    const [tile] = buildAssertionTileModels({
      buckets: [
        assertionBucket({ hour: 0 }),
        assertionBucket({
          hour: 1,
          counts: { [KEY]: { passCount: 60, failCount: 0 } },
        }),
      ],
      instanceKey: INSTANCE,
      configuredKeys: [KEY],
      labelForKey,
    });
    expect(tile.sparkValues).toEqual([null, 100]);
  });

  test("unknown config (no read access) leaves configured undefined", () => {
    const [tile] = buildAssertionTileModels({
      buckets: [
        assertionBucket({
          hour: 0,
          counts: { [KEY]: { passCount: 1, failCount: 0 } },
        }),
      ],
      instanceKey: INSTANCE,
      labelForKey,
    });
    expect(tile.configured).toBeUndefined();
  });
});

describe("buildTileModels: gauge tiles with dominance baselines", () => {
  test("dominance baselines describe the historical share, never the 0.0% mean band", () => {
    const [tile] = buildTileModels({
      fields: [field({ name: "successRate", chartType: "gauge", unit: "%" })],
      buckets: [bucket({ hour: 0, fields: { successRate: 67 } })],
      baselines: [
        baseline({
          fieldPath: "collectors.healthcheck.http.success",
          // Dominance baseline: mean/stdDev are 0 and meaningless.
          mean: 0,
          stdDev: 0,
          dominantValue: "true",
          dominantRatio: 0.983,
        }),
      ],
      instanceKey: INSTANCE,
    });
    // The humanized dominant VALUE plus its share - never the raw "true",
    // and never a bare "98%" that begs "of what?".
    expect(tile.baselineChips?.expected).toBe("Usually success (98%)");
  });

  test("a false-dominant baseline names the dominant value", () => {
    const [tile] = buildTileModels({
      fields: [field({ name: "successRate", chartType: "gauge", unit: "%" })],
      buckets: [bucket({ hour: 0, fields: { successRate: 10 } })],
      baselines: [
        baseline({
          fieldPath: "collectors.healthcheck.http.success",
          mean: 0,
          stdDev: 0,
          dominantValue: "false",
          dominantRatio: 0.9,
        }),
      ],
      instanceKey: INSTANCE,
    });
    // The check usually fails: say so, instead of a bare inverted share.
    expect(tile.baselineChips?.expected).toBe("Usually not success (90%)");
  });

  test("a missing dominant ratio drops the share instead of fabricating 100%", () => {
    const [tile] = buildTileModels({
      fields: [field({ name: "successRate", chartType: "gauge", unit: "%" })],
      buckets: [bucket({ hour: 0, fields: { successRate: 67 } })],
      baselines: [
        baseline({
          fieldPath: "collectors.healthcheck.http.success",
          mean: 0,
          stdDev: 0,
          dominantValue: "true",
          dominantRatio: null,
        }),
      ],
      instanceKey: INSTANCE,
    });
    expect(tile.baselineChips?.expected).toBe("Usually success");
  });

  test("a categorical dominant names the value with its share", () => {
    const [tile] = buildTileModels({
      fields: [field({ name: "successRate", chartType: "gauge", unit: "%" })],
      buckets: [bucket({ hour: 0, fields: { successRate: 50 } })],
      baselines: [
        baseline({
          fieldPath: "collectors.healthcheck.http.success",
          mean: 0,
          stdDev: 0,
          dominantValue: "primary",
          dominantRatio: 0.9,
        }),
      ],
      instanceKey: INSTANCE,
    });
    expect(tile.baselineChips?.expected).toBe("Usually primary (90%)");
  });
});

describe("buildTileModels: dominance chips with annotated boolean labels", () => {
  test("the raw field's x-chart-true-label beats the name-derived fallback", () => {
    const [tile] = buildTileModels({
      fields: [field({ name: "successRate", chartType: "gauge", unit: "%" })],
      buckets: [bucket({ hour: 0, fields: { successRate: 98 } })],
      baselines: [
        baseline({
          fieldPath: "collectors.healthcheck.http.success",
          mean: 0,
          stdDev: 0,
          dominantValue: "true",
          dominantRatio: 0.98,
        }),
      ],
      instanceKey: INSTANCE,
      rawFields: [
        field({
          name: "success",
          chartType: "boolean",
          trueLabel: "successful",
          falseLabel: "failing",
        }),
      ],
    });
    expect(tile.baselineChips?.expected).toBe("Usually successful (98%)");
  });

  test("a false dominant uses the annotated false label", () => {
    const [tile] = buildTileModels({
      fields: [field({ name: "successRate", chartType: "gauge", unit: "%" })],
      buckets: [bucket({ hour: 0, fields: { successRate: 10 } })],
      baselines: [
        baseline({
          fieldPath: "collectors.healthcheck.http.success",
          mean: 0,
          stdDev: 0,
          dominantValue: "false",
          dominantRatio: 0.9,
        }),
      ],
      instanceKey: INSTANCE,
      rawFields: [
        field({
          name: "success",
          chartType: "boolean",
          trueLabel: "successful",
          falseLabel: "failing",
        }),
      ],
    });
    expect(tile.baselineChips?.expected).toBe("Usually failing (90%)");
  });

  test("boolean tiles prefer their own annotated labels over Yes/No", () => {
    const [tile] = buildTileModels({
      fields: [
        field({
          name: "valid",
          chartType: "boolean",
          trueLabel: "valid",
          falseLabel: "invalid",
        }),
      ],
      buckets: [bucket({ hour: 0, fields: { valid: true } })],
      baselines: [
        baseline({
          fieldPath: "collectors.healthcheck.http.valid",
          mean: 0,
          stdDev: 0,
          dominantValue: "true",
          dominantRatio: 0.99,
        }),
      ],
      instanceKey: INSTANCE,
    });
    expect(tile.dominantChip).toBe("Usually valid (99%)");
  });
});
