import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import path from "node:path";
import {
  withTestDb,
  isIntegrationEnabled,
  type TestDb,
} from "@checkstack/test-utils-backend";
import { MAX_EXEMPLARS_PER_POINT } from "@checkstack/telemetry-common";
import * as schema from "../schema";
import {
  countStreamSeries,
  selectExistingSeriesIds,
  insertNewSeries,
  touchSeriesLastSeen,
  deleteExpiredSeriesBatch,
  type NewSeriesRow,
} from "./series";
import { upsertMetricNames, listMetricNames, decrementSeriesCount } from "./names";
import {
  upsertMinuteBuckets,
  readWindowAggregate,
  readCumulativePoints,
  rollupMinuteToHourly,
  deleteExpiredMinuteBuckets,
  type MinuteBucketDelta,
} from "./buckets";
import { touchStreamActivity, readStreamActivity } from "./activity";
import {
  updateSeriesExemplars,
  readSeriesExemplars,
} from "./exemplars";
import { floorToMinute } from "./time";
import { computeSeriesId } from "./series-id";

const MIGRATIONS = path.join(import.meta.dir, "..", "..", "drizzle");

function newSeries(
  streamId: string,
  name: string,
  labels: Record<string, string>,
  seenAt: Date,
): NewSeriesRow {
  return {
    id: computeSeriesId({ streamId, name, labels }),
    streamId,
    name,
    labels,
    counterKind: null,
    firstSeenAt: seenAt,
    lastSeenAt: seenAt,
  };
}

describe.skipIf(!isIntegrationEnabled())(
  "metricstream storage (integration)",
  () => {
    let test: TestDb<typeof schema>;

    beforeAll(async () => {
      test = await withTestDb({ schema, migrationsFolder: MIGRATIONS });
    });
    afterAll(async () => {
      await test.dispose();
    });

    it("inserts new series, counts them, and detects existing ones", async () => {
      const runner = test.db;
      const now = new Date();
      const a = newSeries("s1", "m", { host: "a" }, now);
      const b = newSeries("s1", "m", { host: "b" }, now);
      await insertNewSeries({ runner, rows: [a, b] });
      // Idempotent on conflict.
      await insertNewSeries({ runner, rows: [a] });

      expect(await countStreamSeries({ runner, streamId: "s1" })).toBe(2);
      const existing = await selectExistingSeriesIds({
        runner,
        seriesIds: [a.id, b.id, "does-not-exist"],
      });
      expect(existing.has(a.id)).toBe(true);
      expect(existing.has(b.id)).toBe(true);
      expect(existing.has("does-not-exist")).toBe(false);
    });

    it("folds minute buckets with latest-lastTs-wins for `last`", async () => {
      const runner = test.db;
      const seriesId = computeSeriesId({
        streamId: "s2",
        name: "g",
        labels: {},
      });
      const bucketStart = floorToMinute(new Date());
      const early = new Date(bucketStart.getTime() + 5_000);
      const late = new Date(bucketStart.getTime() + 40_000);

      const base: Omit<MinuteBucketDelta, "last" | "lastTs" | "count"> = {
        seriesId,
        bucketStart,
        sum: 0,
        min: 0,
        max: 0,
        deltaSum: 0,
      };

      // First write the LATER sample, then an EARLIER one in a second flush.
      await upsertMinuteBuckets({
        runner,
        deltas: [
          { ...base, count: 1, sum: 10, min: 10, max: 10, last: 10, lastTs: late },
        ],
      });
      await upsertMinuteBuckets({
        runner,
        deltas: [
          { ...base, count: 1, sum: 7, min: 7, max: 7, last: 7, lastTs: early },
        ],
      });

      const agg = await readWindowAggregate({
        runner,
        seriesIds: [seriesId],
        from: bucketStart,
        to: new Date(bucketStart.getTime() + 60_000),
        grain: "minute",
      });
      // count/sum/min/max fold additively; `last` stays the LATER sample (10),
      // NOT the later-written earlier sample (7).
      expect(agg.sampleCount).toBe(2);
      expect(agg.sum).toBe(17);
      expect(agg.min).toBe(7);
      expect(agg.max).toBe(10);
      expect(agg.last).toBe(10);
      expect(agg.seriesCount).toBe(1);
    });

    it("accumulates deltaSum and exposes cumulative points for rate math", async () => {
      const runner = test.db;
      const seriesId = computeSeriesId({
        streamId: "s3",
        name: "c",
        labels: {},
      });
      const b0 = floorToMinute(new Date());
      const b1 = new Date(b0.getTime() + 60_000);
      await upsertMinuteBuckets({
        runner,
        deltas: [
          { seriesId, bucketStart: b0, count: 1, sum: 100, min: 100, max: 100, last: 100, lastTs: b0, deltaSum: 5 },
          { seriesId, bucketStart: b1, count: 1, sum: 130, min: 130, max: 130, last: 130, lastTs: b1, deltaSum: 30 },
        ],
      });
      const points = await readCumulativePoints({
        runner,
        seriesIds: [seriesId],
        from: b0,
        to: new Date(b1.getTime() + 60_000),
        grain: "minute",
      });
      expect(points.map((p) => p.last)).toEqual([100, 130]);
    });

    it("maintains metric_names seriesCount across upsert + decrement", async () => {
      const runner = test.db;
      const now = new Date();
      await upsertMetricNames({
        runner,
        upserts: [
          {
            streamId: "s4",
            name: "m",
            type: "counter",
            counterKind: "cumulative",
            unit: null,
            help: null,
            seriesCountDelta: 3,
            lastSeenAt: now,
          },
        ],
      });
      await upsertMetricNames({
        runner,
        upserts: [
          {
            streamId: "s4",
            name: "m",
            type: "counter",
            counterKind: "cumulative",
            unit: "s",
            help: null,
            seriesCountDelta: 2,
            lastSeenAt: now,
          },
        ],
      });
      let names = await listMetricNames({ runner, streamId: "s4", limit: 10 });
      expect(names).toHaveLength(1);
      expect(names[0].seriesCount).toBe(5);
      expect(names[0].unit).toBe("s");

      await decrementSeriesCount({ runner, streamId: "s4", name: "m", delta: 4 });
      names = await listMetricNames({ runner, streamId: "s4", limit: 10 });
      expect(names[0].seriesCount).toBe(1);
    });

    it("rolls minute buckets up to hourly and deletes the folded minutes", async () => {
      const runner = test.db;
      const seriesId = computeSeriesId({
        streamId: "s5",
        name: "g",
        labels: {},
      });
      const hourStart = new Date(
        Math.floor(Date.now() / 3_600_000) * 3_600_000 - 3_600_000,
      );
      const m0 = new Date(hourStart.getTime());
      const m1 = new Date(hourStart.getTime() + 60_000);
      await upsertMinuteBuckets({
        runner,
        deltas: [
          { seriesId, bucketStart: m0, count: 2, sum: 20, min: 5, max: 15, last: 15, lastTs: m0, deltaSum: 0 },
          { seriesId, bucketStart: m1, count: 3, sum: 33, min: 3, max: 20, last: 11, lastTs: m1, deltaSum: 0 },
        ],
      });
      const cutoff = new Date(Date.now());
      // The rollup is a GLOBAL maintenance op (all series), so it also folds
      // earlier tests' minute buckets - assert it folded at least this test's 2.
      const folded = await rollupMinuteToHourly({ runner, olderThan: cutoff, limit: 1000 });
      expect(folded).toBeGreaterThanOrEqual(2);
      const deleted = await deleteExpiredMinuteBuckets({ runner, cutoff, limit: 1000 });
      expect(deleted).toBeGreaterThanOrEqual(2);

      const agg = await readWindowAggregate({
        runner,
        seriesIds: [seriesId],
        from: hourStart,
        to: new Date(hourStart.getTime() + 3_600_000),
        grain: "hour",
      });
      expect(agg.sampleCount).toBe(5);
      expect(agg.sum).toBe(53);
      expect(agg.min).toBe(3);
      expect(agg.max).toBe(20);
      // `last` is the sample with the greatest lastTs (m1 -> 11).
      expect(agg.last).toBe(11);
    });

    it("advances lastSeen and expires old series in bounded batches", async () => {
      const runner = test.db;
      const old = new Date(Date.now() - 10 * 24 * 3_600_000);
      const fresh = new Date();
      const stale = newSeries("s6", "m", { k: "stale" }, old);
      const kept = newSeries("s6", "m", { k: "kept" }, old);
      await insertNewSeries({ runner, rows: [stale, kept] });
      await touchSeriesLastSeen({ runner, seriesIds: [kept.id], lastSeenAt: fresh });

      const cutoff = new Date(Date.now() - 24 * 3_600_000);
      const deleted = await deleteExpiredSeriesBatch({
        runner,
        streamId: "s6",
        cutoff,
        limit: 100,
      });
      expect(deleted).toEqual([stale.id]);
      expect(await countStreamSeries({ runner, streamId: "s6" })).toBe(1);
    });

    it("touches activity and accumulates drop counters", async () => {
      const runner = test.db;
      const now = new Date();
      await touchStreamActivity({
        runner,
        streamId: "s7",
        receivedAt: now,
        rateEstimate: 120,
        droppedSeries: 2,
        droppedDatapoints: 40,
      });
      await touchStreamActivity({
        runner,
        streamId: "s7",
        receivedAt: now,
        rateEstimate: 130,
        droppedSeries: 3,
        droppedDatapoints: 10,
      });
      const activity = await readStreamActivity({ runner, streamId: "s7" });
      expect(activity?.droppedSeriesCount).toBe(5);
      expect(activity?.droppedDatapointsCount).toBe(50);
      expect(activity?.approxDatapointsPerMinute).toBe(130);
    });

    it("persists + reads series exemplars, windowed, deduped, capped newest-first", async () => {
      const runner = test.db;
      const seenAt = new Date("2026-07-12T12:00:00.000Z");
      const from = new Date("2026-07-12T12:00:00.000Z");
      const to = new Date("2026-07-12T13:00:00.000Z");
      const tA = new Date("2026-07-12T12:10:00.000Z").getTime();
      const tB = new Date("2026-07-12T12:20:00.000Z").getTime();
      const tBefore = new Date("2026-07-12T11:00:00.000Z").getTime();

      const a = newSeries("s-ex", "m", { host: "a" }, seenAt);
      const b = newSeries("s-ex", "m", { host: "b" }, seenAt);
      // Series c is admitted WITH exemplars seeded on the insert row.
      const c: NewSeriesRow = {
        ...newSeries("s-ex", "m", { host: "c" }, seenAt),
        lastExemplars: [
          { traceId: "c".repeat(32), value: 3, tsMs: new Date("2026-07-12T12:30:00.000Z").getTime() },
        ],
      };
      await insertNewSeries({ runner, rows: [a, b, c] });

      // a: two in-window exemplars; b: one BEFORE the window (must be excluded).
      await updateSeriesExemplars({
        runner,
        updates: [
          {
            seriesId: a.id,
            exemplars: [
              { traceId: "a".repeat(32), value: 1, tsMs: tA },
              { traceId: "b".repeat(32), value: 2, tsMs: tB },
            ],
          },
          {
            seriesId: b.id,
            exemplars: [{ traceId: "d".repeat(32), value: 9, tsMs: tBefore }],
          },
        ],
      });

      const seriesIds = [a.id, b.id, c.id];
      const all = await readSeriesExemplars({ runner, seriesIds, from, to, limit: 12 });
      // Newest-first union across a + c, the out-of-window b exemplar excluded.
      expect(all.map((e) => e.traceId)).toEqual([
        "c".repeat(32), // 12:30
        "b".repeat(32), // 12:20
        "a".repeat(32), // 12:10
      ]);

      const capped = await readSeriesExemplars({ runner, seriesIds, from, to, limit: 2 });
      expect(capped.map((e) => e.traceId)).toEqual(["c".repeat(32), "b".repeat(32)]);
    });

    it("MERGES exemplars across flushes (union kept, batched over series)", async () => {
      const runner = test.db;
      const seenAt = new Date("2026-07-10T12:00:00.000Z");
      const from = new Date("2026-07-10T12:00:00.000Z");
      const to = new Date("2026-07-10T13:00:00.000Z");
      const at = (min: number) =>
        new Date(
          `2026-07-10T12:${String(min).padStart(2, "0")}:00.000Z`,
        ).getTime();
      const id = (label: string) => label.padEnd(32, "0");

      const a = newSeries("s-merge", "m", { host: "a" }, seenAt);
      const b = newSeries("s-merge", "m", { host: "b" }, seenAt);
      await insertNewSeries({ runner, rows: [a, b] });

      // Flush 1: a and b each get one exemplar (a multi-series batch).
      await updateSeriesExemplars({
        runner,
        updates: [
          { seriesId: a.id, exemplars: [{ traceId: id("a1"), value: 1, tsMs: at(10) }] },
          { seriesId: b.id, exemplars: [{ traceId: id("b1"), value: 1, tsMs: at(10) }] },
        ],
      });
      // Flush 2: a gets a NEWER exemplar. It must UNION with flush 1's, not
      // overwrite it - the regression this fix targets.
      await updateSeriesExemplars({
        runner,
        updates: [
          { seriesId: a.id, exemplars: [{ traceId: id("a2"), value: 2, tsMs: at(20) }] },
        ],
      });

      const mergedA = await readSeriesExemplars({
        runner,
        seriesIds: [a.id],
        from,
        to,
        limit: 12,
      });
      expect(mergedA.map((e) => e.traceId)).toEqual([id("a2"), id("a1")]);

      // b was in flush 1's batch but not flush 2's - its exemplar is untouched.
      const keptB = await readSeriesExemplars({
        runner,
        seriesIds: [b.id],
        from,
        to,
        limit: 12,
      });
      expect(keptB.map((e) => e.traceId)).toEqual([id("b1")]);
    });

    it("dedupes by traceId and caps the persisted set when merging", async () => {
      const runner = test.db;
      const seenAt = new Date("2026-07-11T12:00:00.000Z");
      const from = new Date("2026-07-11T12:00:00.000Z");
      const to = new Date("2026-07-11T13:00:00.000Z");
      const at = (min: number) =>
        new Date(
          `2026-07-11T12:${String(min).padStart(2, "0")}:00.000Z`,
        ).getTime();
      const id = (label: string) => label.padEnd(32, "0");

      const s = newSeries("s-cap", "m", { host: "x" }, seenAt);
      await insertNewSeries({ runner, rows: [s] });

      await updateSeriesExemplars({
        runner,
        updates: [
          { seriesId: s.id, exemplars: [{ traceId: id("dup"), value: 1, tsMs: at(5) }] },
        ],
      });
      // A newer occurrence of the SAME trace plus three fresh ones: after the
      // union the same trace must appear ONCE and only the newest few survive.
      await updateSeriesExemplars({
        runner,
        updates: [
          {
            seriesId: s.id,
            exemplars: [
              { traceId: id("dup"), value: 2, tsMs: at(50) },
              { traceId: id("n1"), value: 3, tsMs: at(40) },
              { traceId: id("n2"), value: 4, tsMs: at(30) },
              { traceId: id("n3"), value: 5, tsMs: at(20) },
            ],
          },
        ],
      });

      const stored = await readSeriesExemplars({
        runner,
        seriesIds: [s.id],
        from,
        to,
        limit: 100,
      });
      expect(stored.length).toBe(MAX_EXEMPLARS_PER_POINT);
      const ids = stored.map((e) => e.traceId);
      expect(ids.filter((t) => t === id("dup"))).toHaveLength(1);
      // Newest-first: dup@50, n1@40, n2@30, n3@20 (the older dup@5 is dropped).
      expect(ids).toEqual([id("dup"), id("n1"), id("n2"), id("n3")]);
    });
  },
);
