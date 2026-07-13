import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import path from "node:path";
import { eq } from "drizzle-orm";
import {
  withTestDb,
  isIntegrationEnabled,
  type TestDb,
} from "@checkstack/test-utils-backend";
import { DEFAULT_METRIC_STREAM_CONFIG } from "@checkstack/metricstream-common";
import * as schema from "../schema";
import { createStorage, computeSeriesId, floorToMinute, floorToHour } from "../storage";
import { createDbReader, loadStreamHandle } from "./reader";
import { MetricWindowCollector } from "./metric-window-collector";
import type { MetricStreamHealthClient } from "./strategy";
import { runStreamRetention } from "./retention";

const MIGRATIONS = path.join(import.meta.dir, "..", "..", "drizzle");
const STREAM = "stream-health-it";
const CREATED = new Date("2026-01-01T00:00:00.000Z");
const BASE = floorToMinute(new Date("2026-06-01T12:00:00.000Z"));
const NOW = new Date(BASE.getTime() + 150_000); // 12:02:30

/** Build the collector client the strategy would hand over, for a stream. */
async function buildClient(
  db: TestDb<typeof schema>["db"],
  now: () => Date = () => NOW,
): Promise<MetricStreamHealthClient> {
  const handle = await loadStreamHandle({ db, streamId: STREAM });
  if (!handle) throw new Error("stream not found");
  const reader = createDbReader({ db, storage: createStorage({ db }), handle, now });
  return {
    streamId: STREAM,
    reader,
    exec: () => Promise.reject(new Error("no exec")),
  };
}

describe.skipIf(!isIntegrationEnabled())("metricstream health (integration)", () => {
  let test: TestDb<typeof schema>;

  beforeAll(async () => {
    test = await withTestDb({ schema, migrationsFolder: MIGRATIONS });
  });
  afterAll(async () => {
    await test.dispose();
  });

  beforeEach(async () => {
    const { db } = test;
    await db.delete(schema.metricMinuteBuckets);
    await db.delete(schema.metricHourlyBuckets);
    await db.delete(schema.metricSeries);
    await db.delete(schema.metricNames);
    await db.delete(schema.metricImportantEvents);
    await db.delete(schema.metricStreamActivity);
    await db.delete(schema.metricStreams);
    await db.insert(schema.metricStreams).values({
      id: STREAM,
      name: "Health IT",
      config: DEFAULT_METRIC_STREAM_CONFIG,
      createdAt: CREATED,
      updatedAt: CREATED,
    });
  });

  it("reads windowed aggregates + reset-aware counter rate from seeded buckets", async () => {
    const { db } = test;
    const name = "http_requests_total";
    const labels = { method: "GET" };
    const seriesId = computeSeriesId({ streamId: STREAM, name, labels });
    // Series last seen at m2 (12:02:00) -> 30s before NOW.
    const lastSeenAt = new Date(BASE.getTime() + 120_000);

    await db.insert(schema.metricNames).values({
      streamId: STREAM,
      name,
      type: "counter",
      counterKind: "cumulative",
      unit: null,
      help: null,
      seriesCount: 1,
      lastSeenAt,
    });
    await db.insert(schema.metricSeries).values({
      id: seriesId,
      streamId: STREAM,
      name,
      labels,
      counterKind: "cumulative",
      firstSeenAt: BASE,
      lastSeenAt,
    });
    // Cumulative snapshots across three minutes: 100 -> 130 -> [reset] 40.
    const bucket = (offsetMin: number, last: number) => ({
      seriesId,
      bucketStart: new Date(BASE.getTime() + offsetMin * 60_000),
      count: 1,
      sum: last,
      min: last,
      max: last,
      last,
      lastTs: new Date(BASE.getTime() + offsetMin * 60_000 + 30_000),
      deltaSum: 0,
    });
    await db
      .insert(schema.metricMinuteBuckets)
      .values([bucket(0, 100), bucket(1, 130), bucket(2, 40)]);

    const collector = new MetricWindowCollector(() => NOW);
    const client = await buildClient(db);
    const { result, error } = await collector.execute({
      config: { metricName: name, labelFilters: [], windowSeconds: 300 },
      client,
      pluginId: "metricstream",
    });

    expect(error).toBeUndefined();
    expect(result).toBeDefined();
    // avg = (100+130+40)/3 = 90; last = latest lastTs (m2 -> 40).
    expect(result!.avgValue).toBe(90);
    expect(result!.minValue).toBe(40);
    expect(result!.maxValue).toBe(130);
    expect(result!.lastValue).toBe(40);
    expect(result!.sampleCount).toBe(3);
    expect(result!.seriesCount).toBe(1);
    // reset-aware increase = (130-100) + 40 = 70; rate = 70 / 300s.
    expect(result!.increase).toBe(70);
    expect(result!.ratePerSecond).toBeCloseTo(70 / 300, 4);
    expect(result!.secondsSinceLastSample).toBe(30);
  });

  it("stitches minute + hourly tiers for a window wider than minute retention", async () => {
    const { db } = test;
    const HOUR = 3_600_000;
    // A stream that keeps only 6h of minute buckets; a 24h window MUST reach into
    // the hourly tier for the older 18h or it silently under-reports.
    await db
      .update(schema.metricStreams)
      .set({ config: { ...DEFAULT_METRIC_STREAM_CONFIG, minuteRetentionHours: 6 } })
      .where(eq(schema.metricStreams.id, STREAM));

    const name = "http_requests_total";
    const labels = { method: "GET" };
    const seriesId = computeSeriesId({ streamId: STREAM, name, labels });
    const lastSeenAt = new Date(NOW.getTime() - HOUR); // 1h before NOW
    await db.insert(schema.metricNames).values({
      streamId: STREAM,
      name,
      type: "counter",
      counterKind: "cumulative",
      unit: null,
      help: null,
      seriesCount: 1,
      lastSeenAt,
    });
    await db.insert(schema.metricSeries).values({
      id: seriesId,
      streamId: STREAM,
      name,
      labels,
      counterKind: "cumulative",
      firstSeenAt: new Date(NOW.getTime() - 24 * HOUR),
      lastSeenAt,
    });

    const bucket = (bucketStart: Date, last: number) => ({
      seriesId,
      bucketStart,
      count: 1,
      sum: last,
      min: last,
      max: last,
      last,
      lastTs: new Date(bucketStart.getTime() + 30_000),
      deltaSum: 0,
    });
    // COARSE part (older than the 6h boundary) lives in the HOURLY tier:
    // cumulative 100 -> 250.
    await db.insert(schema.metricHourlyBuckets).values([
      bucket(floorToHour(new Date(NOW.getTime() - 20 * HOUR)), 100),
      bucket(floorToHour(new Date(NOW.getTime() - 10 * HOUR)), 250),
    ]);
    // FINE part (within 6h) lives in the MINUTE tier: 400 -> [reset] 50 -> 90.
    await db.insert(schema.metricMinuteBuckets).values([
      bucket(floorToMinute(new Date(NOW.getTime() - 5 * HOUR)), 400),
      bucket(floorToMinute(new Date(NOW.getTime() - 2 * HOUR)), 50),
      bucket(floorToMinute(new Date(NOW.getTime() - HOUR)), 90),
    ]);

    const collector = new MetricWindowCollector(() => NOW);
    const client = await buildClient(db);
    const { result, error } = await collector.execute({
      config: { metricName: name, labelFilters: [], windowSeconds: 86_400 },
      client,
      pluginId: "metricstream",
    });

    expect(error).toBeUndefined();
    // ALL five buckets across both tiers are read (minute-only would see 3).
    expect(result!.sampleCount).toBe(5);
    // A series present in both tiers is counted ONCE (not double-counted).
    expect(result!.seriesCount).toBe(1);
    // Aggregate folds across tiers: sum 890, avg 178, min 50, max 400.
    expect(result!.avgValue).toBe(178);
    expect(result!.minValue).toBe(50);
    expect(result!.maxValue).toBe(400);
    // last = newest sample (the -1h minute bucket).
    expect(result!.lastValue).toBe(90);
    // Reset-aware increase stitched across the boundary:
    // (250-100)+(400-250)+50(reset)+(90-50) = 390. Minute-only would read 90.
    expect(result!.increase).toBe(390);
    // rate = 390 / 86400s, rounded to 4 decimals by the collector.
    expect(result!.ratePerSecond).toBe(0.0045);
  });

  it("matches only series carrying every exact label filter", async () => {
    const { db } = test;
    const name = "latency_ms";
    const seriesA = computeSeriesId({
      streamId: STREAM,
      name,
      labels: { region: "eu", host: "a" },
    });
    const seriesB = computeSeriesId({
      streamId: STREAM,
      name,
      labels: { region: "us", host: "b" },
    });
    await db.insert(schema.metricNames).values({
      streamId: STREAM,
      name,
      type: "gauge",
      counterKind: null,
      unit: null,
      help: null,
      seriesCount: 2,
      lastSeenAt: NOW,
    });
    await db.insert(schema.metricSeries).values([
      {
        id: seriesA,
        streamId: STREAM,
        name,
        labels: { region: "eu", host: "a" },
        counterKind: null,
        firstSeenAt: BASE,
        lastSeenAt: NOW,
      },
      {
        id: seriesB,
        streamId: STREAM,
        name,
        labels: { region: "us", host: "b" },
        counterKind: null,
        firstSeenAt: BASE,
        lastSeenAt: NOW,
      },
    ]);
    const mk = (sid: string, value: number) => ({
      seriesId: sid,
      bucketStart: new Date(BASE.getTime() + 60_000),
      count: 1,
      sum: value,
      min: value,
      max: value,
      last: value,
      lastTs: new Date(BASE.getTime() + 90_000),
      deltaSum: 0,
    });
    await db
      .insert(schema.metricMinuteBuckets)
      .values([mk(seriesA, 10), mk(seriesB, 999)]);

    const collector = new MetricWindowCollector(() => NOW);
    const client = await buildClient(db);
    const { result } = await collector.execute({
      config: {
        metricName: name,
        labelFilters: [{ key: "region", value: "eu" }],
        windowSeconds: 300,
      },
      client,
      pluginId: "metricstream",
    });
    // Only series A (region=eu) matches; series B's 999 is excluded.
    expect(result!.seriesCount).toBe(1);
    expect(result!.maxValue).toBe(10);
    expect(result!.lastValue).toBe(10);
  });

  it("retention spares a referenced metric name's registry rows", async () => {
    const { db } = test;
    const referenced = "kept_metric";
    const orphan = "gone_metric";
    const old = new Date(NOW.getTime() - 200 * 86_400_000); // beyond 90d hourly retention
    for (const name of [referenced, orphan]) {
      const sid = computeSeriesId({ streamId: STREAM, name, labels: {} });
      await db.insert(schema.metricNames).values({
        streamId: STREAM,
        name,
        type: "gauge",
        counterKind: null,
        unit: null,
        help: null,
        seriesCount: 1,
        lastSeenAt: old,
      });
      await db.insert(schema.metricSeries).values({
        id: sid,
        streamId: STREAM,
        name,
        labels: {},
        counterKind: null,
        firstSeenAt: old,
        lastSeenAt: old,
      });
      // No buckets remain (already aged out) -> series is a delete candidate.
    }

    await runStreamRetention({
      db,
      streamId: STREAM,
      config: DEFAULT_METRIC_STREAM_CONFIG,
      now: NOW,
      referencedNames: new Set([referenced]),
    });

    const names = await db
      .select({ name: schema.metricNames.name })
      .from(schema.metricNames);
    expect(names.map((n) => n.name)).toEqual([referenced]);
    const series = await db
      .select({ name: schema.metricSeries.name })
      .from(schema.metricSeries);
    expect(series.map((s) => s.name)).toEqual([referenced]);
  });
});
