import { describe, it, expect } from "bun:test";
import {
  resolveGrain,
  rollupBoundary,
  partitionWindowAtBoundary,
  sumSeverityPointsByHour,
  sumPatternPointsByHour,
  addSeverityTotals,
  AUTO_MINUTE_MAX_MS,
  ZERO_SEVERITY_TOTALS,
} from "./buckets-merge";

const at = (iso: string) => new Date(iso);

describe("resolveGrain", () => {
  it("honors an explicit grain regardless of width", () => {
    expect(
      resolveGrain({
        from: at("2026-01-01T00:00:00Z"),
        to: at("2026-06-01T00:00:00Z"),
        explicit: "minute",
      }),
    ).toBe("minute");
    expect(
      resolveGrain({
        from: at("2026-01-01T00:00:00Z"),
        to: at("2026-01-01T00:01:00Z"),
        explicit: "hour",
      }),
    ).toBe("hour");
  });

  it("auto-picks minute at/under the threshold and hour above it", () => {
    const from = at("2026-01-01T00:00:00Z");
    expect(
      resolveGrain({ from, to: new Date(from.getTime() + AUTO_MINUTE_MAX_MS) }),
    ).toBe("minute");
    expect(
      resolveGrain({
        from,
        to: new Date(from.getTime() + AUTO_MINUTE_MAX_MS + 1),
      }),
    ).toBe("hour");
  });
});

describe("rollupBoundary", () => {
  it("is `now - minuteRetentionHours` floored to the hour", () => {
    const now = at("2026-01-02T05:37:12Z");
    expect(rollupBoundary({ now, minuteRetentionHours: 48 })).toEqual(
      at("2025-12-31T05:00:00Z"),
    );
  });
});

describe("partitionWindowAtBoundary", () => {
  const boundary = at("2026-01-02T00:00:00Z");

  it("splits a window straddling the boundary into disjoint coarse+fine ranges", () => {
    const { coarse, fine } = partitionWindowAtBoundary({
      from: at("2026-01-01T00:00:00Z"),
      to: at("2026-01-03T00:00:00Z"),
      boundary,
    });
    expect(coarse).toEqual({
      from: at("2026-01-01T00:00:00Z"),
      to: boundary,
    });
    expect(fine).toEqual({ from: boundary, to: at("2026-01-03T00:00:00Z") });
  });

  it("returns only fine when the whole window is newer than the boundary", () => {
    const { coarse, fine } = partitionWindowAtBoundary({
      from: at("2026-01-02T06:00:00Z"),
      to: at("2026-01-02T12:00:00Z"),
      boundary,
    });
    expect(coarse).toBeNull();
    expect(fine).toEqual({
      from: at("2026-01-02T06:00:00Z"),
      to: at("2026-01-02T12:00:00Z"),
    });
  });

  it("returns only coarse when the whole window is older than the boundary", () => {
    const { coarse, fine } = partitionWindowAtBoundary({
      from: at("2026-01-01T00:00:00Z"),
      to: at("2026-01-01T12:00:00Z"),
      boundary,
    });
    expect(fine).toBeNull();
    expect(coarse).toEqual({
      from: at("2026-01-01T00:00:00Z"),
      to: at("2026-01-01T12:00:00Z"),
    });
  });
});

describe("sumSeverityPointsByHour", () => {
  it("folds minute points into their hour and sums, keeping coarse hours intact", () => {
    const merged = sumSeverityPointsByHour([
      // coarse (already hour-aligned)
      { bucketStart: at("2026-01-01T00:00:00Z"), band: "error", count: 10 },
      // fine minute points in the 05:00 hour
      { bucketStart: at("2026-01-01T05:00:00Z"), band: "error", count: 2 },
      { bucketStart: at("2026-01-01T05:30:00Z"), band: "error", count: 3 },
      { bucketStart: at("2026-01-01T05:59:00Z"), band: "warn", count: 1 },
    ]);
    // Within an hour, points sort by severity rank (warn before error).
    expect(merged).toEqual([
      { bucketStart: at("2026-01-01T00:00:00Z"), band: "error", count: 10 },
      { bucketStart: at("2026-01-01T05:00:00Z"), band: "warn", count: 1 },
      { bucketStart: at("2026-01-01T05:00:00Z"), band: "error", count: 5 },
    ]);
  });

  it("returns an ascending, deterministic ordering", () => {
    const merged = sumSeverityPointsByHour([
      { bucketStart: at("2026-01-01T02:00:00Z"), band: "info", count: 1 },
      { bucketStart: at("2026-01-01T01:00:00Z"), band: "fatal", count: 1 },
      { bucketStart: at("2026-01-01T01:00:00Z"), band: "info", count: 1 },
    ]);
    expect(merged.map((p) => `${p.bucketStart.toISOString()}:${p.band}`)).toEqual(
      [
        "2026-01-01T01:00:00.000Z:info",
        "2026-01-01T01:00:00.000Z:fatal",
        "2026-01-01T02:00:00.000Z:info",
      ],
    );
  });
});

describe("sumPatternPointsByHour", () => {
  it("folds minute pattern points into their hour and sums per pattern", () => {
    const merged = sumPatternPointsByHour([
      { bucketStart: at("2026-01-01T05:01:00Z"), patternId: "p1", count: 2 },
      { bucketStart: at("2026-01-01T05:59:00Z"), patternId: "p1", count: 4 },
      { bucketStart: at("2026-01-01T05:10:00Z"), patternId: "p2", count: 1 },
    ]);
    expect(merged).toEqual([
      { bucketStart: at("2026-01-01T05:00:00Z"), patternId: "p1", count: 6 },
      { bucketStart: at("2026-01-01T05:00:00Z"), patternId: "p2", count: 1 },
    ]);
  });
});

describe("addSeverityTotals", () => {
  it("adds band-by-band", () => {
    expect(
      addSeverityTotals(
        { ...ZERO_SEVERITY_TOTALS, error: 3, warn: 1 },
        { ...ZERO_SEVERITY_TOTALS, error: 4, info: 5 },
      ),
    ).toEqual({ trace: 0, debug: 0, info: 5, warn: 1, error: 7, fatal: 0 });
  });
});
