import { describe, it, expect } from "bun:test";
import {
  seriesUsageRatio,
  seriesUsageTone,
  seriesUsagePercent,
} from "./usage-tone";

describe("seriesUsageRatio", () => {
  it("divides count by cap", () => {
    expect(seriesUsageRatio({ seriesCount: 4000, seriesCap: 5000 })).toBe(0.8);
  });

  it("returns 0 for a zero or invalid cap (never divides by zero)", () => {
    expect(seriesUsageRatio({ seriesCount: 10, seriesCap: 0 })).toBe(0);
    expect(seriesUsageRatio({ seriesCount: 10, seriesCap: -1 })).toBe(0);
    expect(seriesUsageRatio({ seriesCount: 10, seriesCap: Number.NaN })).toBe(0);
  });
});

describe("seriesUsageTone", () => {
  it("is default below 80%", () => {
    expect(seriesUsageTone(0.79)).toBe("default");
  });

  it("warns from 80% up to the cap", () => {
    expect(seriesUsageTone(0.8)).toBe("warn");
    expect(seriesUsageTone(0.99)).toBe("warn");
  });

  it("is down at or above the cap (series being dropped)", () => {
    expect(seriesUsageTone(1)).toBe("down");
    expect(seriesUsageTone(1.4)).toBe("down");
  });
});

describe("seriesUsagePercent", () => {
  it("rounds to a whole percent and never goes below 0", () => {
    expect(seriesUsagePercent(0.826)).toBe(83);
    expect(seriesUsagePercent(0)).toBe(0);
    expect(seriesUsagePercent(-0.2)).toBe(0);
  });
});
