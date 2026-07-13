import { describe, it, expect } from "bun:test";
import { IngestCountersRegistry } from "./counters";

describe("IngestCountersRegistry", () => {
  it("accumulates per-stream received/dropped and records flush timing", () => {
    const registry = new IngestCountersRegistry();
    registry.addReceived("s1", 100);
    registry.addReceived("s1", 50);
    registry.addDropped("s1", 5);
    registry.recordFlush("s1", 12.6);
    registry.recordFlush("s1", 8.2);

    expect(registry.get("s1")).toEqual({
      linesReceived: 150,
      linesDropped: 5,
      flushes: 2,
      lastFlushMs: 8, // rounded, last wins
    });
  });

  it("returns zeroes for an unseen stream and isolates streams", () => {
    const registry = new IngestCountersRegistry();
    registry.addReceived("s1", 10);
    expect(registry.get("s2")).toEqual({
      linesReceived: 0,
      linesDropped: 0,
      flushes: 0,
      lastFlushMs: 0,
    });
  });
});
