import { describe, it, expect } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { healthCheckAggregates } from "./schema";
import {
  buildDailyAggregates,
  DAILY_AGGREGATE_CONFLICT_TARGET,
  type HourlyAggregateRow,
} from "./retention-job";

function hourly(overrides: Partial<HourlyAggregateRow>): HourlyAggregateRow {
  return {
    bucketStart: new Date("2026-01-01T03:00:00.000Z"),
    environmentId: null,
    sourceId: null,
    sourceLabel: null,
    runCount: 1,
    healthyCount: 1,
    degradedCount: 0,
    unhealthyCount: 0,
    latencySumMs: 100,
    avgLatencyMs: 100,
    minLatencyMs: 100,
    maxLatencyMs: 100,
    p95LatencyMs: 100,
    ...overrides,
  };
}

describe("buildDailyAggregates", () => {
  it("keeps per-environment series separate within the same day", () => {
    // Two hourly buckets on the same day but for different environments must NOT
    // collapse into one daily row (they are distinct rows under the unique key).
    const daily = buildDailyAggregates([
      hourly({
        bucketStart: new Date("2026-01-01T03:00:00.000Z"),
        environmentId: "prod",
      }),
      hourly({
        bucketStart: new Date("2026-01-01T09:00:00.000Z"),
        environmentId: "staging",
      }),
    ]);

    expect(daily).toHaveLength(2);
    const envs = daily.map((d) => d.environmentId).sort();
    expect(envs).toEqual(["prod", "staging"]);
    // Both fall on the same UTC day start.
    for (const d of daily) {
      expect(d.bucketStart.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    }
  });

  it("keeps per-source series separate within the same day+environment", () => {
    const daily = buildDailyAggregates([
      hourly({ environmentId: "prod", sourceId: null }),
      hourly({ environmentId: "prod", sourceId: "satellite-eu" }),
    ]);
    expect(daily).toHaveLength(2);
    expect(new Set(daily.map((d) => d.sourceId))).toEqual(
      new Set<string | null>(["satellite-eu", null]),
    );
  });

  it("sums counts and folds latency stats within a group", () => {
    const daily = buildDailyAggregates([
      hourly({
        bucketStart: new Date("2026-01-01T01:00:00.000Z"),
        environmentId: "prod",
        runCount: 2,
        healthyCount: 1,
        degradedCount: 1,
        unhealthyCount: 0,
        latencySumMs: 300,
        minLatencyMs: 50,
        maxLatencyMs: 250,
        p95LatencyMs: 240,
      }),
      hourly({
        bucketStart: new Date("2026-01-01T05:00:00.000Z"),
        environmentId: "prod",
        runCount: 3,
        healthyCount: 3,
        degradedCount: 0,
        unhealthyCount: 0,
        latencySumMs: 300,
        minLatencyMs: 80,
        maxLatencyMs: 120,
        p95LatencyMs: 110,
      }),
    ]);

    expect(daily).toHaveLength(1);
    const d = daily[0];
    expect(d.runCount).toBe(5);
    expect(d.healthyCount).toBe(4);
    expect(d.degradedCount).toBe(1);
    expect(d.latencySumMs).toBe(600);
    expect(d.avgLatencyMs).toBe(120); // 600 / 5
    expect(d.minLatencyMs).toBe(50);
    expect(d.maxLatencyMs).toBe(250);
    expect(d.p95LatencyMs).toBe(240);
  });
});

describe("DAILY_AGGREGATE_CONFLICT_TARGET", () => {
  it("matches the health_check_aggregates unique constraint exactly", () => {
    // Postgres rejects an ON CONFLICT target that does not match a real unique
    // constraint (SQLSTATE 42P10). Keep the rollup's upsert target in lock-step
    // with the schema's unique constraint so the rollup can never throw 42P10.
    const { uniqueConstraints } = getTableConfig(healthCheckAggregates);
    expect(uniqueConstraints).toHaveLength(1);
    const constraintCols = uniqueConstraints[0].columns
      .map((c) => c.name)
      .sort();
    const targetCols = DAILY_AGGREGATE_CONFLICT_TARGET.map((c) => c.name).sort();
    expect(targetCols).toEqual(constraintCols);
  });
});
