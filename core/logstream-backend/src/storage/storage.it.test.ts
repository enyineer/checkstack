import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import path from "node:path";
import {
  withTestDb,
  isIntegrationEnabled,
  type TestDb,
} from "@checkstack/test-utils-backend";
import * as schema from "../schema";
import { insertLogEventsBatch } from "./events";
import {
  upsertSeverityBuckets,
  upsertPatternBuckets,
  upsertPatterns,
  readSeverityBuckets,
  sumSeverityBands,
} from "./buckets";
import {
  touchStreamActivity,
  readStreamActivity,
  addInTransitDrops,
} from "./activity";
import { floorToMinute } from "./time";

const MIGRATIONS = path.join(import.meta.dir, "..", "..", "drizzle");

describe.skipIf(!isIntegrationEnabled())("logstream storage (integration)", () => {
  let test: TestDb<typeof schema>;

  beforeAll(async () => {
    test = await withTestDb({ schema, migrationsFolder: MIGRATIONS });
  });
  afterAll(async () => {
    await test.dispose();
  });

  it("inserts raw events in a batch", async () => {
    const runner = test.db;
    const now = new Date();
    await insertLogEventsBatch({
      runner,
      rows: [
        {
          streamId: "s1",
          ts: now,
          observedAt: now,
          severityNumber: 18,
          band: "error",
          body: "boom",
        },
        {
          streamId: "s1",
          ts: now,
          observedAt: now,
          severityNumber: 9,
          band: "info",
          body: "hello",
        },
      ],
    });
    const rows = await runner.select().from(schema.logEvents);
    expect(rows).toHaveLength(2);
  });

  it("accumulates severity buckets on conflict", async () => {
    const runner = test.db;
    const bucketStart = floorToMinute(new Date());
    const delta = {
      streamId: "s2",
      bucketStart,
      band: "error" as const,
      count: 3,
    };
    await upsertSeverityBuckets({ runner, deltas: [delta] });
    await upsertSeverityBuckets({ runner, deltas: [{ ...delta, count: 4 }] });

    const totals = await sumSeverityBands({
      runner,
      streamId: "s2",
      from: new Date(bucketStart.getTime() - 1),
      to: new Date(bucketStart.getTime() + 60_000),
      grain: "minute",
    });
    expect(totals.error).toBe(7);

    const points = await readSeverityBuckets({
      runner,
      streamId: "s2",
      from: new Date(bucketStart.getTime() - 1),
      to: new Date(bucketStart.getTime() + 60_000),
      grain: "minute",
    });
    expect(points).toEqual([{ bucketStart, band: "error", count: 7 }]);
  });

  it("accumulates pattern buckets and pattern totals on conflict", async () => {
    const runner = test.db;
    const bucketStart = floorToMinute(new Date());
    await upsertPatternBuckets({
      runner,
      deltas: [{ streamId: "s3", bucketStart, patternId: "p1", count: 2 }],
    });
    await upsertPatternBuckets({
      runner,
      deltas: [{ streamId: "s3", bucketStart, patternId: "p1", count: 5 }],
    });
    const [bucket] = await runner
      .select()
      .from(schema.logPatternBuckets);
    expect(Number(bucket.count)).toBe(7);

    const seen1 = new Date("2026-07-12T10:00:00Z");
    const seen2 = new Date("2026-07-12T11:00:00Z");
    const base = {
      id: "p1",
      streamId: "s3",
      template: "error <*>",
      tokenCount: 2,
      firstSeenAt: seen1,
      sampleBody: "error 42",
    };
    await upsertPatterns({
      runner,
      patterns: [
        { ...base, lastSeenAt: seen1, totalCount: 2, severityMax: 18 },
      ],
    });
    await upsertPatterns({
      runner,
      patterns: [
        { ...base, lastSeenAt: seen2, totalCount: 5, severityMax: 12 },
      ],
    });
    const [pattern] = await runner.select().from(schema.logPatterns);
    expect(Number(pattern.totalCount)).toBe(7);
    expect(pattern.lastSeenAt).toEqual(seen2);
    expect(pattern.severityMax).toBe(18); // monotonic max, not overwritten
  });

  it("touches stream activity once (upsert)", async () => {
    const runner = test.db;
    const t1 = new Date("2026-07-12T10:00:00Z");
    const t2 = new Date("2026-07-12T10:05:00Z");
    await touchStreamActivity({
      runner,
      streamId: "s4",
      receivedAt: t1,
      flushAt: t1,
      rateEstimate: 120,
    });
    await touchStreamActivity({
      runner,
      streamId: "s4",
      receivedAt: t2,
      flushAt: t2,
      rateEstimate: 240,
    });
    const activity = await readStreamActivity({ runner, streamId: "s4" });
    expect(activity?.lastReceivedAt).toEqual(t2);
    expect(activity?.approxRatePerMinute).toBe(240);
  });

  it("accumulates satellite in-transit drops on conflict (upsert)", async () => {
    const runner = test.db;
    // First drop upserts the row even though the stream never touched activity.
    await addInTransitDrops({ runner, streamId: "s5", dropped: 4 });
    const afterFirst = await readStreamActivity({ runner, streamId: "s5" });
    expect(afterFirst?.droppedInTransitCount).toBe(4);

    // A second drop accumulates onto the running total.
    await addInTransitDrops({ runner, streamId: "s5", dropped: 3 });
    const afterSecond = await readStreamActivity({ runner, streamId: "s5" });
    expect(afterSecond?.droppedInTransitCount).toBe(7);

    // A non-positive count is a no-op.
    await addInTransitDrops({ runner, streamId: "s5", dropped: 0 });
    const afterNoop = await readStreamActivity({ runner, streamId: "s5" });
    expect(afterNoop?.droppedInTransitCount).toBe(7);
  });
});
