import { describe, expect, it } from "bun:test";
import type { SeverityBucketPoint } from "@checkstack/logstream-common";
import { toStackedBuckets } from "./severity-buckets";

function point(
  bucketStart: string,
  band: SeverityBucketPoint["band"],
  count: number,
): SeverityBucketPoint {
  return { bucketStart: new Date(bucketStart), band, count };
}

describe("toStackedBuckets", () => {
  it("folds bands into the three visible stacks per bucket", () => {
    const buckets = toStackedBuckets({
      grain: "minute",
      points: [
        point("2026-01-01T00:00:00Z", "error", 3),
        point("2026-01-01T00:00:00Z", "fatal", 1),
        point("2026-01-01T00:00:00Z", "info", 10),
        point("2026-01-01T00:00:00Z", "debug", 5),
      ],
    });
    expect(buckets).toHaveLength(1);
    expect(buckets[0].counts).toEqual({ down: 4, ok: 10, unknown: 5 });
  });

  it("sets end from the grain span and sorts oldest-first", () => {
    const buckets = toStackedBuckets({
      grain: "hour",
      points: [
        point("2026-01-01T02:00:00Z", "warn", 2),
        point("2026-01-01T01:00:00Z", "warn", 1),
      ],
    });
    expect(buckets.map((b) => b.start)).toEqual([
      new Date("2026-01-01T01:00:00Z").getTime(),
      new Date("2026-01-01T02:00:00Z").getTime(),
    ]);
    expect(buckets[0].end - buckets[0].start).toBe(3_600_000);
    expect(buckets[0].counts).toEqual({ warn: 1 });
  });

  it("returns an empty array for no points", () => {
    expect(toStackedBuckets({ grain: "minute", points: [] })).toEqual([]);
  });
});
