import { describe, expect, test } from "bun:test";
import type { AnomalyBaselineDto } from "@checkstack/anomaly-common";
import {
  booleanDominantLabels,
  deriveExpectedBand,
  deriveTrend,
  formatBaselineChips,
  formatDominantChip,
  matchBaseline,
} from "./baseline.logic";

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

describe("matchBaseline", () => {
  const baselines = [
    baseline({ id: "exact", fieldPath: "collectors.abc.responseTime" }),
    baseline({ id: "raw-success", fieldPath: "collectors.abc.success" }),
    baseline({ id: "strategy", fieldPath: "latencyMs" }),
  ];

  test("exact aggregated path wins", () => {
    expect(
      matchBaseline({
        baselines,
        fieldName: "responseTime",
        collectorId: "abc",
      })?.id,
    ).toBe("exact");
  });

  test("avg/min/max prefixes map back to the raw field name", () => {
    // avgResponseTime has no exact baseline; falls back to responseTime.
    expect(
      matchBaseline({
        baselines,
        fieldName: "avgResponseTime",
        collectorId: "abc",
      })?.id,
    ).toBe("exact");
    expect(
      matchBaseline({
        baselines,
        fieldName: "maxResponseTime",
        collectorId: "abc",
      })?.id,
    ).toBe("exact");
  });

  test("successRate maps back to success", () => {
    expect(
      matchBaseline({
        baselines,
        fieldName: "successRate",
        collectorId: "abc",
      })?.id,
    ).toBe("raw-success");
  });

  test("strategy-level fields resolve without a collector prefix", () => {
    expect(
      matchBaseline({ baselines, fieldName: "latencyMs" })?.id,
    ).toBe("strategy");
  });

  test("no match yields undefined", () => {
    expect(
      matchBaseline({ baselines, fieldName: "unknownField", collectorId: "abc" }),
    ).toBeUndefined();
  });
});

describe("deriveExpectedBand", () => {
  test("scales sigma by sqrt of the average runs per bucket", () => {
    // avg run count 9 => spread = (30 / 3) * 3 = 30 => band [70, 130].
    const band = deriveExpectedBand({
      baseline: baseline({ mean: 100, stdDev: 30 }),
      buckets: [{ runCount: 9 }, { runCount: 9 }],
    });
    expect(band).toEqual({ from: 70, to: 130, spread: 30, mean: 100 });
  });

  test("clamps the band floor to zero", () => {
    // avg run count 1 => spread = 90 => raw floor -80 clamps to 0.
    const band = deriveExpectedBand({
      baseline: baseline({ mean: 10, stdDev: 30 }),
      buckets: [{ runCount: 1 }],
    });
    expect(band?.from).toBe(0);
    expect(band?.to).toBe(100);
  });

  test("zero runCounts count as one run (matches prior inline logic)", () => {
    const band = deriveExpectedBand({
      baseline: baseline({ mean: 100, stdDev: 30 }),
      buckets: [{ runCount: 0 }],
    });
    expect(band?.spread).toBe(90);
  });

  test("no baseline yields undefined", () => {
    expect(
      deriveExpectedBand({ baseline: undefined, buckets: [{ runCount: 5 }] }),
    ).toBeUndefined();
  });
});

describe("deriveTrend", () => {
  test("projects slope over the sample window and flags >= 2 sigma drift", () => {
    // 0.5 * 100 = 50 projected; 50 / 20 = 2.5 sigma => drifting.
    const trend = deriveTrend({
      baseline: baseline({ trendSlope: 0.5, sampleCount: 100, stdDev: 20 }),
    });
    expect(trend).toEqual({ projectedChange: 50, isDrifting: true });
  });

  test("below 2 sigma is not drifting", () => {
    const trend = deriveTrend({
      baseline: baseline({ trendSlope: 0.2, sampleCount: 100, stdDev: 20 }),
    });
    expect(trend).toEqual({ projectedChange: 20, isDrifting: false });
  });

  test("negligible projection (<= 0.01) yields undefined", () => {
    expect(
      deriveTrend({
        baseline: baseline({ trendSlope: 0.0001, sampleCount: 100 }),
      }),
    ).toBeUndefined();
  });

  test("zero stdDev never drifts", () => {
    const trend = deriveTrend({
      baseline: baseline({ trendSlope: 1, sampleCount: 100, stdDev: 0 }),
    });
    expect(trend?.isDrifting).toBe(false);
  });

  test("no baseline yields undefined", () => {
    expect(deriveTrend({ baseline: undefined })).toBeUndefined();
  });
});

describe("formatBaselineChips", () => {
  test("formats the latency-style chips (0 decimals)", () => {
    const chips = formatBaselineChips({
      band: { from: 70, to: 130, spread: 30, mean: 100 },
      trend: { projectedChange: 12.4, isDrifting: true },
      unit: "ms",
    });
    expect(chips.expected).toBe("Expected: 100ms (±30)");
    expect(chips.trend).toEqual({ text: "Trend: ↑ +12ms", drifting: true });
  });

  test("formats generic-metric chips (1 decimal) with a negative trend", () => {
    const chips = formatBaselineChips({
      band: { from: 1, to: 3, spread: 1, mean: 2 },
      trend: { projectedChange: -0.53, isDrifting: false },
      unit: "%",
      decimals: 1,
    });
    expect(chips.expected).toBe("Expected: 2.0% (±1.0)");
    expect(chips.trend).toEqual({ text: "Trend: ↓ -0.5%", drifting: false });
  });

  test("omits chips for missing inputs", () => {
    expect(formatBaselineChips({ band: undefined, trend: undefined })).toEqual(
      {},
    );
  });
});

describe("formatDominantChip", () => {
  test("names the dominant value with its historical share", () => {
    expect(
      formatDominantChip({
        baseline: baseline({ dominantValue: "primary", dominantRatio: 0.98 }),
      }),
    ).toBe("Usually primary (98%)");
  });

  test("omits ratio when absent", () => {
    expect(
      formatDominantChip({
        baseline: baseline({ dominantValue: "true", dominantRatio: null }),
      }),
    ).toBe("Usually true");
  });

  test("boolean labels humanize true/false per surface", () => {
    expect(
      formatDominantChip({
        baseline: baseline({ dominantValue: "true", dominantRatio: 0.98 }),
        booleanLabels: { true: "success", false: "not success" },
      }),
    ).toBe("Usually success (98%)");
    expect(
      formatDominantChip({
        baseline: baseline({ dominantValue: "false", dominantRatio: 0.9 }),
        booleanLabels: { true: "Yes", false: "No" },
      }),
    ).toBe("Usually No (90%)");
    // Non-boolean dominants ignore the labels.
    expect(
      formatDominantChip({
        baseline: baseline({ dominantValue: "primary", dominantRatio: 0.9 }),
        booleanLabels: { true: "Yes", false: "No" },
      }),
    ).toBe("Usually primary (90%)");
  });
});

describe("booleanDominantLabels", () => {
  test("derives human labels from the raw field name", () => {
    expect(booleanDominantLabels({ fieldPath: "collectors.abc.success" })).toEqual(
      { true: "success", false: "not success" },
    );
    expect(booleanDominantLabels({ fieldPath: "isValid" })).toEqual({
      true: "is valid",
      false: "not is valid",
    });
    expect(
      booleanDominantLabels({ fieldPath: "collectors.abc.cert_valid" }),
    ).toEqual({ true: "cert valid", false: "not cert valid" });
  });

  test("null dominant value yields undefined", () => {
    expect(formatDominantChip({ baseline: baseline({}) })).toBeUndefined();
    expect(formatDominantChip({ baseline: undefined })).toBeUndefined();
  });
});
