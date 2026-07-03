import { describe, expect, test } from "bun:test";
import type { AggregatedBucket } from "@checkstack/healthcheck-common";
import {
  buildRunHistoryRows,
  isLastRawPage,
  rawRetentionCutoff,
  shouldQueryAggregates,
} from "./runHistoryRows.logic";

const NOW = new Date("2026-07-03T12:00:00.000Z");
const DAY = 86_400_000;

function bucket({
  daysAgo,
  successRate = 100,
}: {
  daysAgo: number;
  successRate?: number;
}): AggregatedBucket {
  const start = new Date(NOW.getTime() - daysAgo * DAY);
  return {
    bucketStart: start,
    bucketEnd: new Date(start.getTime() + 3_600_000),
    bucketIntervalSeconds: 3600,
    runCount: 60,
    healthyCount: Math.round((successRate / 100) * 60),
    degradedCount: 0,
    unhealthyCount: 60 - Math.round((successRate / 100) * 60),
    successRate,
  };
}

describe("rawRetentionCutoff", () => {
  test("subtracts whole retention days from now", () => {
    expect(rawRetentionCutoff({ rawRetentionDays: 7, now: NOW })).toEqual(
      new Date("2026-06-26T12:00:00.000Z"),
    );
  });
});

describe("isLastRawPage", () => {
  test("last page, past-the-end, and empty results all count", () => {
    expect(isLastRawPage({ page: 3, totalPages: 3 })).toBe(true);
    expect(isLastRawPage({ page: 4, totalPages: 3 })).toBe(true);
    expect(isLastRawPage({ page: 1, totalPages: 0 })).toBe(true);
    expect(isLastRawPage({ page: 1, totalPages: 3 })).toBe(false);
  });
});

describe("shouldQueryAggregates", () => {
  const cutoff = rawRetentionCutoff({ rawRetentionDays: 7, now: NOW });

  test("true only when the range reaches past the cutoff on the last page", () => {
    expect(
      shouldQueryAggregates({
        rangeStart: new Date(NOW.getTime() - 30 * DAY),
        cutoff,
        page: 2,
        totalPages: 2,
      }),
    ).toBe(true);
  });

  test("false within the raw window or on an earlier page", () => {
    expect(
      shouldQueryAggregates({
        rangeStart: new Date(NOW.getTime() - 3 * DAY),
        cutoff,
        page: 1,
        totalPages: 1,
      }),
    ).toBe(false);
    expect(
      shouldQueryAggregates({
        rangeStart: new Date(NOW.getTime() - 30 * DAY),
        cutoff,
        page: 1,
        totalPages: 3,
      }),
    ).toBe(false);
  });
});

describe("buildRunHistoryRows", () => {
  const cutoff = rawRetentionCutoff({ rawRetentionDays: 7, now: NOW });
  const runs = [{ id: "r1" }, { id: "r2" }];

  test("raw runs only when not on the last page", () => {
    const rows = buildRunHistoryRows({
      runs,
      buckets: [bucket({ daysAgo: 10 })],
      cutoff,
      isLastPage: false,
    });
    expect(rows.map((r) => r.kind)).toEqual(["run", "run"]);
  });

  test("appends divider + pre-cutoff aggregates newest-first on the last page", () => {
    const rows = buildRunHistoryRows({
      runs,
      buckets: [
        bucket({ daysAgo: 20 }),
        bucket({ daysAgo: 10, successRate: 90 }),
      ],
      cutoff,
      isLastPage: true,
    });
    expect(rows.map((r) => r.kind)).toEqual([
      "run",
      "run",
      "retentionDivider",
      "aggregate",
      "aggregate",
    ]);
    const aggregates = rows.filter((r) => r.kind === "aggregate");
    // Newest aggregate (10 days ago) first.
    expect(
      aggregates[0].kind === "aggregate" && aggregates[0].bucket.successRate,
    ).toBe(90);
  });

  test("drops buckets that end after the cutoff (covered by raw runs)", () => {
    const rows = buildRunHistoryRows({
      runs,
      buckets: [bucket({ daysAgo: 2 })],
      cutoff,
      isLastPage: true,
    });
    expect(rows.map((r) => r.kind)).toEqual(["run", "run"]);
  });

  test("zero raw runs with pre-cutoff aggregates yields divider then aggregates", () => {
    const rows = buildRunHistoryRows({
      runs: [],
      buckets: [bucket({ daysAgo: 12 })],
      cutoff,
      isLastPage: true,
    });
    expect(rows.map((r) => r.kind)).toEqual(["retentionDivider", "aggregate"]);
  });

  test("no divider when there is nothing aggregated", () => {
    const rows = buildRunHistoryRows({
      runs,
      buckets: [],
      cutoff,
      isLastPage: true,
    });
    expect(rows.map((r) => r.kind)).toEqual(["run", "run"]);
  });
});
