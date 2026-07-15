import { describe, it, expect } from "bun:test";
import type { ScopedQueryRunner } from "@checkstack/backend-api";
import {
  DEFAULT_METRIC_STREAM_CONFIG,
  type MetricStreamConfig,
  type NormalizedDatapoint,
} from "@checkstack/metricstream-common";
import { computeSeriesId, floorToMinute } from "../storage";
import type { MinuteBucketDelta, SeriesExemplarUpdate } from "../storage";
import type { NewSeriesRow } from "../storage/series";
import type { MetricNameUpsert } from "../storage/names";
import { foldDatapoints, writeFlushPlan, type FlushStorage } from "./flush";
import type { BufferedDatapoint } from "./sink";

const STREAM = "s1";

function item(dp: Partial<NormalizedDatapoint> & { name: string; value: number }): BufferedDatapoint {
  return {
    streamId: STREAM,
    datapoint: {
      name: dp.name,
      type: dp.type ?? "gauge",
      counterKind: dp.counterKind,
      unit: dp.unit,
      labels: dp.labels ?? {},
      value: dp.value,
      ts: dp.ts ?? new Date("2026-07-12T12:00:30.000Z"),
      ...(dp.exemplars ? { exemplars: dp.exemplars } : {}),
    },
  };
}

const TRACE_A = "a".repeat(32);
const TRACE_B = "b".repeat(32);

describe("foldDatapoints", () => {
  it("folds gauge samples of one series into a single minute bucket", async () => {
    const ts = new Date("2026-07-12T12:00:10.000Z");
    const later = new Date("2026-07-12T12:00:50.000Z");
    const fold = await foldDatapoints({
      streamId: STREAM,
      items: [
        item({ name: "g", value: 10, ts }),
        item({ name: "g", value: 30, ts: later }),
        item({ name: "g", value: 20, ts }),
      ],
    });

    expect(fold.total).toBe(3);
    expect(fold.series.size).toBe(1);
    expect(fold.buckets.size).toBe(1);
    const bucket = [...fold.buckets.values()][0];
    expect(bucket.count).toBe(3);
    expect(bucket.sum).toBe(60);
    expect(bucket.min).toBe(10);
    expect(bucket.max).toBe(30);
    // last = the sample with the greatest ts (30 @ 12:00:50), not insertion order.
    expect(bucket.last).toBe(30);
    expect(bucket.lastTs.getTime()).toBe(later.getTime());
    expect(bucket.deltaSum).toBe(0);
    expect(bucket.bucketStart.getTime()).toBe(floorToMinute(ts).getTime());
  });

  it("splits a series across minute boundaries", async () => {
    const fold = await foldDatapoints({
      streamId: STREAM,
      items: [
        item({ name: "g", value: 1, ts: new Date("2026-07-12T12:00:30.000Z") }),
        item({ name: "g", value: 2, ts: new Date("2026-07-12T12:01:30.000Z") }),
      ],
    });
    expect(fold.buckets.size).toBe(2);
  });

  it("accumulates deltaSum only for delta counters", async () => {
    const fold = await foldDatapoints({
      streamId: STREAM,
      items: [
        item({ name: "c", type: "counter", counterKind: "delta", value: 5 }),
        item({ name: "c", type: "counter", counterKind: "delta", value: 7 }),
      ],
    });
    const bucket = [...fold.buckets.values()][0];
    expect(bucket.deltaSum).toBe(12);
    expect(bucket.sum).toBe(12);
    const series = [...fold.series.values()][0];
    expect(series.counterKind).toBe("delta");
    expect(series.type).toBe("counter");
  });

  it("keeps deltaSum 0 for cumulative counters (rate is read-time diff)", async () => {
    const fold = await foldDatapoints({
      streamId: STREAM,
      items: [
        item({ name: "c", type: "counter", counterKind: "cumulative", value: 100 }),
        item({ name: "c", type: "counter", counterKind: "cumulative", value: 130 }),
      ],
    });
    const bucket = [...fold.buckets.values()][0];
    expect(bucket.deltaSum).toBe(0);
  });

  it("distinguishes series by labels and tracks per-name registry info", async () => {
    const fold = await foldDatapoints({
      streamId: STREAM,
      items: [
        item({ name: "m", value: 1, labels: { host: "a" }, unit: "s" }),
        item({ name: "m", value: 2, labels: { host: "b" }, unit: "s" }),
      ],
    });
    expect(fold.series.size).toBe(2);
    expect(fold.names.size).toBe(1);
    expect(fold.names.get("m")?.unit).toBe("s");
  });

  it("folds a series' exemplars, dedupes by trace id, keeps the newest", async () => {
    const t1 = new Date("2026-07-12T12:00:10.000Z");
    const t2 = new Date("2026-07-12T12:00:50.000Z");
    const fold = await foldDatapoints({
      streamId: STREAM,
      items: [
        item({
          name: "g",
          value: 1,
          ts: t1,
          exemplars: [{ traceId: TRACE_A, value: 1, ts: t1 }],
        }),
        item({
          name: "g",
          value: 2,
          ts: t2,
          // Same trace id later + a second trace -> A dedupes to the newest, B kept.
          exemplars: [
            { traceId: TRACE_A, value: 9, ts: t2 },
            { traceId: TRACE_B, value: 3, ts: t2 },
          ],
        }),
      ],
    });
    const series = [...fold.series.values()][0];
    expect(series.exemplars).toHaveLength(2);
    const byTrace = new Map(series.exemplars.map((e) => [e.traceId, e]));
    expect(byTrace.get(TRACE_A)?.value).toBe(9); // newest occurrence won
    expect(byTrace.get(TRACE_A)?.tsMs).toBe(t2.getTime());
    expect(byTrace.get(TRACE_B)?.value).toBe(3);
  });

  it("leaves a series' exemplars empty when no datapoint carries one", async () => {
    const fold = await foldDatapoints({
      streamId: STREAM,
      items: [item({ name: "g", value: 1 })],
    });
    expect([...fold.series.values()][0].exemplars).toEqual([]);
  });

  it("yields the event loop without dropping data", async () => {
    const items = Array.from({ length: 4500 }, (_, i) =>
      item({ name: "g", value: i, labels: { i: String(i) } }),
    );
    const fold = await foldDatapoints({ streamId: STREAM, items, yieldEvery: 1000 });
    expect(fold.total).toBe(4500);
    expect(fold.series.size).toBe(4500);
  });
});

/**
 * A mock FlushStorage capturing every write, with a seedable existing series set.
 * `conflicting` simulates a cross-pod race: an id treated as NEW here but already
 * inserted by another pod - `insertNewSeries` records the attempt but returns
 * only the truly-inserted ids (mirroring `ON CONFLICT DO NOTHING ... RETURNING`).
 */
function mockStorage(
  seed: {
    existing?: Set<string>;
    existingCount?: number;
    conflicting?: Set<string>;
  } = {},
) {
  const calls = {
    inserted: [] as NewSeriesRow[],
    touched: [] as string[],
    nameUpserts: [] as MetricNameUpsert[],
    buckets: [] as MinuteBucketDelta[],
    activity: [] as {
      droppedSeries?: number;
      droppedDatapoints?: number;
      rateEstimate: number;
    }[],
    exemplarUpdates: [] as SeriesExemplarUpdate[],
  };
  const existing = seed.existing ?? new Set<string>();
  const conflicting = seed.conflicting ?? new Set<string>();
  const storage: FlushStorage = {
    selectExistingSeriesIds: async ({ seriesIds }) =>
      new Set(seriesIds.filter((id) => existing.has(id))),
    countStreamSeries: async () => seed.existingCount ?? existing.size,
    insertNewSeries: async ({ rows }) => {
      calls.inserted.push(...rows);
      // Only rows not already present on another pod come back from RETURNING.
      return rows.map((r) => r.id).filter((id) => !conflicting.has(id));
    },
    touchSeriesLastSeen: async ({ seriesIds }) => {
      calls.touched.push(...seriesIds);
    },
    upsertMetricNames: async ({ upserts }) => {
      calls.nameUpserts.push(...upserts);
    },
    upsertMinuteBuckets: async ({ deltas }) => {
      calls.buckets.push(...deltas);
    },
    touchStreamActivity: async ({ droppedSeries, droppedDatapoints, rateEstimate }) => {
      calls.activity.push({ droppedSeries, droppedDatapoints, rateEstimate });
    },
    updateSeriesExemplars: async ({ updates }) => {
      calls.exemplarUpdates.push(...updates);
    },
  };
  return { storage, calls };
}

const fakeRunner = {} as ScopedQueryRunner<never>;
const flushAt = new Date("2026-07-12T12:00:30.000Z");

async function foldFor(items: BufferedDatapoint[]) {
  return foldDatapoints({ streamId: STREAM, items });
}

describe("writeFlushPlan", () => {
  it("admits all new series under the cap and counts none dropped", async () => {
    const fold = await foldFor([
      item({ name: "m", value: 1, labels: { host: "a" } }),
      item({ name: "m", value: 2, labels: { host: "b" } }),
    ]);
    const { storage, calls } = mockStorage();
    const outcome = await writeFlushPlan({
      runner: fakeRunner,
      storage,
      streamId: STREAM,
      fold,
      config: DEFAULT_METRIC_STREAM_CONFIG,
      flushAt,
      rateEstimate: 42,
    });
    expect(outcome.admittedNewSeries).toBe(2);
    expect(outcome.droppedSeries).toBe(0);
    expect(outcome.droppedDatapoints).toBe(0);
    expect(outcome.persistedDatapoints).toBe(2);
    expect(calls.inserted).toHaveLength(2);
    expect(calls.buckets).toHaveLength(2);
    expect(calls.nameUpserts[0].seriesCountDelta).toBe(2);
    expect(calls.activity[0]).toMatchObject({ droppedSeries: 0, rateEstimate: 42 });
  });

  it("drops NEW series past the cardinality cap but keeps existing ones", async () => {
    const existingId = computeSeriesId({ streamId: STREAM, name: "m", labels: { host: "keep" } });
    const fold = await foldFor([
      item({ name: "m", value: 1, labels: { host: "keep" } }), // existing
      item({ name: "m", value: 2, labels: { host: "new1" } }),
      item({ name: "m", value: 3, labels: { host: "new2" } }),
    ]);
    // cap=2, one existing => headroom 1 => admit exactly one new, drop one.
    const config: MetricStreamConfig = { ...DEFAULT_METRIC_STREAM_CONFIG, seriesCap: 2 };
    const { storage, calls } = mockStorage({
      existing: new Set([existingId]),
      existingCount: 1,
    });
    const outcome = await writeFlushPlan({
      runner: fakeRunner,
      storage,
      streamId: STREAM,
      fold,
      config,
      flushAt,
      rateEstimate: 1,
    });
    expect(outcome.admittedNewSeries).toBe(1);
    expect(outcome.droppedSeries).toBe(1);
    expect(outcome.droppedDatapoints).toBe(1);
    expect(outcome.persistedDatapoints).toBe(2);
    // existing series advanced; one new inserted; buckets exclude the dropped one.
    expect(calls.touched).toContain(existingId);
    expect(calls.inserted).toHaveLength(1);
    expect(calls.buckets).toHaveLength(2);
    expect(calls.activity[0]).toMatchObject({ droppedSeries: 1, droppedDatapoints: 1 });
  });

  it("counts only ACTUALLY-inserted series toward a name's seriesCount (cross-pod dup)", async () => {
    // Two new series of one name; one loses a cross-pod insert race (already
    // inserted elsewhere). Its datapoints must still fold into buckets, but the
    // name's seriesCountDelta must be 1 (the truly-new one), not 2.
    const dupId = computeSeriesId({ streamId: STREAM, name: "m", labels: { host: "dup" } });
    const fold = await foldFor([
      item({ name: "m", value: 1, labels: { host: "dup" } }),
      item({ name: "m", value: 2, labels: { host: "fresh" } }),
    ]);
    const { storage, calls } = mockStorage({
      existingCount: 0,
      conflicting: new Set([dupId]),
    });
    const outcome = await writeFlushPlan({
      runner: fakeRunner,
      storage,
      streamId: STREAM,
      fold,
      config: DEFAULT_METRIC_STREAM_CONFIG,
      flushAt,
      rateEstimate: 1,
    });
    // Both were cap-admitted and both sets of datapoints persist to buckets...
    expect(outcome.droppedSeries).toBe(0);
    expect(calls.inserted).toHaveLength(2);
    expect(calls.buckets).toHaveLength(2);
    // ...but only the truly-new series bumps the name's count.
    expect(calls.nameUpserts).toHaveLength(1);
    expect(calls.nameUpserts[0].seriesCountDelta).toBe(1);
  });

  it("seeds a NEW series' exemplars on insert and updates an EXISTING series' exemplars", async () => {
    const ts = new Date("2026-07-12T12:00:10.000Z");
    const existingId = computeSeriesId({ streamId: STREAM, name: "m", labels: { host: "old" } });
    const fold = await foldFor([
      item({ name: "m", value: 1, labels: { host: "old" }, exemplars: [{ traceId: TRACE_A, value: 1, ts }] }),
      item({ name: "m", value: 2, labels: { host: "new" }, exemplars: [{ traceId: TRACE_B, value: 2, ts }] }),
    ]);
    const { storage, calls } = mockStorage({
      existing: new Set([existingId]),
      existingCount: 1,
    });
    await writeFlushPlan({
      runner: fakeRunner,
      storage,
      streamId: STREAM,
      fold,
      config: DEFAULT_METRIC_STREAM_CONFIG,
      flushAt,
      rateEstimate: 1,
    });
    // New series carries its exemplars on the insert row.
    const newRow = calls.inserted.find((r) => r.name === "m" && r.labels.host === "new");
    expect(newRow?.lastExemplars?.[0].traceId).toBe(TRACE_B);
    // Existing series is updated out-of-band (not via insert).
    expect(calls.exemplarUpdates).toEqual([
      { seriesId: existingId, exemplars: [{ traceId: TRACE_A, value: 1, tsMs: ts.getTime() }] },
    ]);
  });

  it("does not persist exemplars for a series capped by cardinality", async () => {
    const ts = new Date("2026-07-12T12:00:10.000Z");
    const fold = await foldFor([
      item({ name: "capped", value: 1, labels: { host: "x" }, exemplars: [{ traceId: TRACE_A, value: 1, ts }] }),
    ]);
    const config: MetricStreamConfig = { ...DEFAULT_METRIC_STREAM_CONFIG, seriesCap: 0 };
    const { storage, calls } = mockStorage({ existingCount: 0 });
    await writeFlushPlan({
      runner: fakeRunner,
      storage,
      streamId: STREAM,
      fold,
      config,
      flushAt,
      rateEstimate: 0,
    });
    expect(calls.inserted).toHaveLength(0);
    expect(calls.exemplarUpdates).toHaveLength(0);
  });

  it("does not register a metric name whose every series was capped", async () => {
    const fold = await foldFor([
      item({ name: "capped", value: 1, labels: { host: "x" } }),
    ]);
    const config: MetricStreamConfig = { ...DEFAULT_METRIC_STREAM_CONFIG, seriesCap: 0 };
    const { storage, calls } = mockStorage({ existingCount: 0 });
    const outcome = await writeFlushPlan({
      runner: fakeRunner,
      storage,
      streamId: STREAM,
      fold,
      config,
      flushAt,
      rateEstimate: 0,
    });
    expect(outcome.droppedSeries).toBe(1);
    expect(calls.nameUpserts).toHaveLength(0);
    expect(calls.buckets).toHaveLength(0);
  });
});
