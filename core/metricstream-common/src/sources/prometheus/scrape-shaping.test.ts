import { describe, it, expect } from "bun:test";
import type { NormalizedDatapoint } from "../../schemas";
import { capScrapeSeries } from "./scrape-shaping";

describe("capScrapeSeries", () => {
  it("keeps datapoints of the first N distinct series and drops the rest", () => {
    const dps: NormalizedDatapoint[] = [
      { name: "m", type: "gauge", labels: { h: "a" }, value: 1, ts: new Date() },
      { name: "m", type: "gauge", labels: { h: "b" }, value: 2, ts: new Date() },
      { name: "m", type: "gauge", labels: { h: "a" }, value: 3, ts: new Date() },
      { name: "m", type: "gauge", labels: { h: "c" }, value: 4, ts: new Date() },
    ];
    const { kept, seriesCount } = capScrapeSeries({ datapoints: dps, maxSeries: 2 });
    expect(seriesCount).toBe(2);
    // series a (2 datapoints) + series b (1) kept; series c dropped.
    expect(kept).toHaveLength(3);
  });
});
