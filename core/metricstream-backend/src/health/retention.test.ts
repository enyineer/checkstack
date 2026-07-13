import { describe, it, expect } from "bun:test";
import { DEFAULT_METRIC_STREAM_CONFIG } from "@checkstack/metricstream-common";
import { computeRetentionCutoffs } from "./retention";

describe("computeRetentionCutoffs", () => {
  const now = new Date("2026-01-10T00:00:00Z");

  it("derives minute + hourly cutoffs from the stream policy", () => {
    // Defaults: minuteRetentionHours 48, hourlyRetentionDays 90.
    const { minuteCutoff, hourlyCutoff } = computeRetentionCutoffs({
      config: DEFAULT_METRIC_STREAM_CONFIG,
      now,
    });
    expect(minuteCutoff.toISOString()).toBe("2026-01-08T00:00:00.000Z"); // -48h
    expect(hourlyCutoff.toISOString()).toBe("2025-10-12T00:00:00.000Z"); // -90d
  });

  it("respects a custom policy", () => {
    const { minuteCutoff, hourlyCutoff } = computeRetentionCutoffs({
      config: { ...DEFAULT_METRIC_STREAM_CONFIG, minuteRetentionHours: 1, hourlyRetentionDays: 1 },
      now,
    });
    expect(minuteCutoff.toISOString()).toBe("2026-01-09T23:00:00.000Z");
    expect(hourlyCutoff.toISOString()).toBe("2026-01-09T00:00:00.000Z");
  });
});
