import { describe, expect, it } from "bun:test";
import {
  DEFAULT_TRACE_STREAM_CONFIG,
  type TraceSamplingConfig,
} from "@checkstack/tracestream-common";
import {
  describeSamplingPolicy,
  formatBaselinePercent,
  formatThreshold,
} from "./sampling-copy";

const base: TraceSamplingConfig = DEFAULT_TRACE_STREAM_CONFIG.sampling;

describe("formatThreshold", () => {
  it("renders ms below a second and seconds above", () => {
    expect(formatThreshold(500)).toBe("500 ms");
    expect(formatThreshold(1000)).toBe("1 s");
    expect(formatThreshold(2500)).toBe("2.5 s");
  });
});

describe("formatBaselinePercent", () => {
  it("keeps small rates legible", () => {
    expect(formatBaselinePercent(0.01)).toBe("1%");
    expect(formatBaselinePercent(0.001)).toBe("0.1%");
    expect(formatBaselinePercent(0.0005)).toBe("0.05%");
    expect(formatBaselinePercent(0.5)).toBe("50%");
    expect(formatBaselinePercent(0)).toBe("0%");
  });
});

describe("describeSamplingPolicy", () => {
  it("describes the default policy: errors kept, slow kept, baseline sampled", () => {
    const lines = describeSamplingPolicy(base);
    expect(lines[0]).toContain("error span is kept");
    expect(lines.some((l) => l.includes("slower than 1 s are kept"))).toBe(true);
    expect(lines.some((l) => l.includes("1% of the remaining"))).toBe(true);
  });

  it("reflects disabled error retention and disabled slow rule", () => {
    const lines = describeSamplingPolicy({
      ...base,
      keepErrorTraces: false,
      slowTraceThresholdMs: null,
      baselineSampleRate: 0,
    });
    expect(lines[0]).toContain("not specially retained");
    expect(lines.some((l) => l.includes("slower than"))).toBe(false);
    expect(lines.some((l) => l.includes("None of the remaining"))).toBe(true);
  });

  it("mentions the hourly ceiling when set", () => {
    const lines = describeSamplingPolicy({
      ...base,
      maxRetainedTracesPerHour: 5000,
    });
    expect(lines.some((l) => l.includes("5,000 traces are retained per hour"))).toBe(
      true,
    );
  });
});
