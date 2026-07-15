import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from "bun:test";
import path from "node:path";
import {
  withTestDb,
  isIntegrationEnabled,
  createMockLogger,
  type TestDb,
} from "@checkstack/test-utils-backend";
import type { RpcClient } from "@checkstack/backend-api";
import { DEFAULT_METRIC_STREAM_CONFIG } from "@checkstack/metricstream-common";
import { eq } from "drizzle-orm";
import * as schema from "../schema";
import { createStorage, computeSeriesId, floorToHour, floorToMinute } from "../storage";
import {
  createMetricstreamService,
  type MetricstreamService,
} from "./service";
import type { AssertAddedSystemsReadable } from "./system-links";

/** No-op added-readability gate for the pure-persistence link tests. */
const allowAll: AssertAddedSystemsReadable = async () => {};

const MIGRATIONS = path.join(import.meta.dir, "..", "..", "drizzle");
const STREAM = "stream-svc-it";
const CREATED = new Date("2026-01-01T00:00:00.000Z");

describe.skipIf(!isIntegrationEnabled())("metricstream service (integration)", () => {
  let test: TestDb<typeof schema>;

  beforeAll(async () => {
    test = await withTestDb({ schema, migrationsFolder: MIGRATIONS });
  });
  afterAll(async () => {
    await test.dispose();
  });

  beforeEach(async () => {
    const { db } = test;
    for (const table of [
      schema.metricMinuteBuckets,
      schema.metricHourlyBuckets,
      schema.metricSeries,
      schema.metricNames,
      schema.metricImportantEvents,
      schema.metricStreamSystemLinks,
      schema.metricStreamActivity,
      schema.metricStreams,
    ]) {
      await db.delete(table);
    }
    await db.insert(schema.metricStreams).values({
      id: STREAM,
      name: "Service IT",
      config: DEFAULT_METRIC_STREAM_CONFIG,
      createdAt: CREATED,
      updatedAt: CREATED,
    });
  });

  function buildService(overrides?: {
    rpcClient?: RpcClient;
    now?: () => Date;
  }): MetricstreamService {
    return createMetricstreamService({
      db: test.db,
      storage: createStorage({ db: test.db }),
      logger: createMockLogger(),
      rpcClient: overrides?.rpcClient,
      ...(overrides?.now ? { now: overrides.now } : {}),
    });
  }

  it("listImportantEvents pages same-millisecond events by keyset without loss", async () => {
    const service = buildService();
    const sharedTs = new Date("2026-01-02T00:00:00.000Z");
    // Five cap/rate events at the SAME ts: an offset-by-ts cursor would skip or
    // repeat rows when a page boundary lands inside the cluster.
    await test.db.insert(schema.metricImportantEvents).values(
      Array.from({ length: 5 }, (_, i) => ({
        id: `evt-${i}`,
        streamId: STREAM,
        ts: sharedTs,
        type: "series_cap" as const,
        title: `event ${i}`,
      })),
    );

    const seen: string[] = [];
    let cursor: { ts: Date; id: string } | undefined;
    let pages = 0;
    for (;;) {
      const page = await service.listImportantEvents({
        streamId: STREAM,
        limit: 2,
        ...(cursor ? { cursor } : {}),
      });
      pages++;
      seen.push(...page.events.map((e) => e.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
      if (pages > 10) throw new Error("paging did not terminate");
    }
    expect(pages).toBe(3); // 2 + 2 + 1
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5); // each row once, none skipped
  });

  it("deleteStream cascades every stream-scoped table + cleans grants", async () => {
    const { db } = test;
    const seriesId = computeSeriesId({ streamId: STREAM, name: "m", labels: {} });

    // Seed one row in every stream-scoped table. (Push tokens are the platform's
    // now - deleting a stream no longer touches a plugin token table.)
    await db.insert(schema.metricNames).values({
      streamId: STREAM,
      name: "m",
      type: "gauge",
      counterKind: null,
      unit: null,
      help: null,
      seriesCount: 1,
      lastSeenAt: CREATED,
    });
    await db.insert(schema.metricSeries).values({
      id: seriesId,
      streamId: STREAM,
      name: "m",
      labels: {},
      counterKind: null,
      firstSeenAt: CREATED,
      lastSeenAt: CREATED,
    });
    const bucket = {
      seriesId,
      bucketStart: CREATED,
      count: 1,
      sum: 1,
      min: 1,
      max: 1,
      last: 1,
      lastTs: CREATED,
      deltaSum: 0,
    };
    await db.insert(schema.metricMinuteBuckets).values(bucket);
    await db.insert(schema.metricHourlyBuckets).values(bucket);
    await db.insert(schema.metricImportantEvents).values({
      id: "ev-1",
      streamId: STREAM,
      ts: CREATED,
      type: "series_cap",
      title: "cap",
      detail: null,
      createdAt: CREATED,
    });
    await db.insert(schema.metricStreamActivity).values({
      streamId: STREAM,
      lastReceivedAt: CREATED,
      approxDatapointsPerMinute: 1,
      droppedSeriesCount: 0,
      droppedDatapointsCount: 0,
    });

    let grantCleanup: { objectType: string; objectId: string } | undefined;
    const rpcClient = {
      forPlugin: () => ({
        deleteObjectRelations: async (arg: {
          objectType: string;
          objectId: string;
        }) => {
          grantCleanup = arg;
        },
      }),
    } as unknown as RpcClient;

    const service = buildService({ rpcClient });

    await service.deleteStream({ id: STREAM });

    // Every stream-scoped table is empty.
    for (const table of [
      schema.metricStreams,
      schema.metricNames,
      schema.metricSeries,
      schema.metricMinuteBuckets,
      schema.metricHourlyBuckets,
      schema.metricImportantEvents,
      schema.metricStreamActivity,
    ]) {
      const rows = await db.select().from(table);
      expect(rows).toHaveLength(0);
    }
    // Grants cleaned under the qualified type.
    expect(grantCleanup).toEqual({
      objectType: "metricstream.stream",
      objectId: STREAM,
    });
  });

  it("label autocomplete returns distinct keys and filtered values", async () => {
    const { db } = test;
    const name = "http_requests_total";
    await db.insert(schema.metricNames).values({
      streamId: STREAM,
      name,
      type: "counter",
      counterKind: "cumulative",
      unit: null,
      help: null,
      seriesCount: 2,
      lastSeenAt: CREATED,
    });
    await db.insert(schema.metricSeries).values([
      {
        id: computeSeriesId({ streamId: STREAM, name, labels: { method: "GET", code: "200" } }),
        streamId: STREAM,
        name,
        labels: { method: "GET", code: "200" },
        counterKind: "cumulative",
        firstSeenAt: CREATED,
        lastSeenAt: CREATED,
      },
      {
        id: computeSeriesId({ streamId: STREAM, name, labels: { method: "POST", code: "500" } }),
        streamId: STREAM,
        name,
        labels: { method: "POST", code: "500" },
        counterKind: "cumulative",
        firstSeenAt: CREATED,
        lastSeenAt: CREATED,
      },
    ]);

    const service = buildService();
    const { keys } = await service.listLabelKeys({
      streamId: STREAM,
      metricName: name,
      limit: 200,
    });
    expect(keys.toSorted()).toEqual(["code", "method"]);

    const { values } = await service.listLabelValues({
      streamId: STREAM,
      metricName: name,
      key: "method",
      limit: 200,
    });
    expect(values.toSorted()).toEqual(["GET", "POST"]);

    const filtered = await service.listLabelValues({
      streamId: STREAM,
      metricName: name,
      key: "method",
      query: "GE",
      limit: 200,
    });
    expect(filtered.values).toEqual(["GET"]);
  });

  it("getMetricBuckets stitches the hourly + minute tiers across the rollup boundary", async () => {
    const { db } = test;
    const HOUR = 3_600_000;
    const NOW = new Date("2026-06-01T12:00:00.000Z");
    // 6h minute retention -> the older part of a 24h window is in the hourly tier.
    await db
      .update(schema.metricStreams)
      .set({ config: { ...DEFAULT_METRIC_STREAM_CONFIG, minuteRetentionHours: 6 } })
      .where(eq(schema.metricStreams.id, STREAM));

    const name = "queue_depth";
    const seriesId = computeSeriesId({ streamId: STREAM, name, labels: {} });
    await db.insert(schema.metricNames).values({
      streamId: STREAM,
      name,
      type: "gauge",
      counterKind: null,
      unit: null,
      help: null,
      seriesCount: 1,
      lastSeenAt: NOW,
    });
    await db.insert(schema.metricSeries).values({
      id: seriesId,
      streamId: STREAM,
      name,
      labels: {},
      counterKind: null,
      firstSeenAt: new Date(NOW.getTime() - 24 * HOUR),
      lastSeenAt: NOW,
    });
    const mk = (bucketStart: Date, v: number) => ({
      seriesId,
      bucketStart,
      count: 1,
      sum: v,
      min: v,
      max: v,
      last: v,
      lastTs: new Date(bucketStart.getTime() + 30_000),
      deltaSum: 0,
    });
    // Coarse (older than 6h) -> hourly tier; fine (within 6h) -> minute tier.
    const coarseHour = floorToHour(new Date(NOW.getTime() - 12 * HOUR));
    const fineMinute = floorToMinute(new Date(NOW.getTime() - 2 * HOUR));
    await db.insert(schema.metricHourlyBuckets).values(mk(coarseHour, 11));
    await db.insert(schema.metricMinuteBuckets).values(mk(fineMinute, 22));

    const service = buildService({ now: () => NOW });
    const { grain, points } = await service.getMetricBuckets({
      streamId: STREAM,
      metricName: name,
      from: new Date(NOW.getTime() - 24 * HOUR),
      to: NOW,
    });
    // A 24h window auto-selects hour grain and merges both tiers.
    expect(grain).toBe("hour");
    const byHour = new Map(points.map((p) => [p.bucketStart.getTime(), p.sum]));
    // The coarse hourly point AND the fine minute point (folded to its hour) both appear.
    expect(byHour.get(coarseHour.getTime())).toBe(11);
    expect(byHour.get(floorToHour(fineMinute).getTime())).toBe(22);
  });


  it("setSystemLinks replaces the whole set (picker semantics, not a patch)", async () => {
    const service = buildService();
    await service.setSystemLinks({
      streamId: STREAM,
      systemIds: ["sys-a", "sys-b"],
      assertAddedReadable: allowAll,
    });
    expect((await service.listSystemLinks({ streamId: STREAM })).systemIds).toEqual([
      "sys-a",
      "sys-b",
    ]);

    // A second call REPLACES: sys-a is dropped, sys-c added, sys-b kept.
    await service.setSystemLinks({
      streamId: STREAM,
      systemIds: ["sys-b", "sys-c"],
      assertAddedReadable: allowAll,
    });
    expect((await service.listSystemLinks({ streamId: STREAM })).systemIds).toEqual([
      "sys-b",
      "sys-c",
    ]);

    // De-dupes a repeated id; clears to empty on an empty set.
    await service.setSystemLinks({
      streamId: STREAM,
      systemIds: ["sys-b", "sys-b"],
      assertAddedReadable: allowAll,
    });
    expect((await service.listSystemLinks({ streamId: STREAM })).systemIds).toEqual([
      "sys-b",
    ]);
    await service.setSystemLinks({
      streamId: STREAM,
      systemIds: [],
      assertAddedReadable: allowAll,
    });
    expect((await service.listSystemLinks({ streamId: STREAM })).systemIds).toEqual([]);
  });

  it("setSystemLinks gates ONLY newly-added systems; retained/removed need no readability", async () => {
    const service = buildService();
    // Seed a link the caller can (hypothetically) not read.
    await service.setSystemLinks({
      streamId: STREAM,
      systemIds: ["sys-existing"],
      assertAddedReadable: allowAll,
    });

    const seen: string[][] = [];
    const spy: AssertAddedSystemsReadable = async (added) => {
      seen.push(added);
    };

    // Keep sys-existing (retained), remove nothing, add sys-new: only sys-new
    // is gated - the retained id is NOT re-checked.
    await service.setSystemLinks({
      streamId: STREAM,
      systemIds: ["sys-existing", "sys-new"],
      assertAddedReadable: spy,
    });
    expect(seen).toEqual([["sys-new"]]);

    // A pure REMOVE (drop sys-new, keep sys-existing) adds nothing -> gate over [].
    await service.setSystemLinks({
      streamId: STREAM,
      systemIds: ["sys-existing"],
      assertAddedReadable: spy,
    });
    expect(seen[1]).toEqual([]);
    expect((await service.listSystemLinks({ streamId: STREAM })).systemIds).toEqual([
      "sys-existing",
    ]);
  });

  it("setSystemLinks blocks the write when the added-gate rejects (nothing persists)", async () => {
    const service = buildService();
    await service.setSystemLinks({
      streamId: STREAM,
      systemIds: ["sys-a"],
      assertAddedReadable: allowAll,
    });
    const deny: AssertAddedSystemsReadable = async () => {
      throw new Error("forbidden: cannot read sys-secret");
    };
    await expect(
      service.setSystemLinks({
        streamId: STREAM,
        systemIds: ["sys-a", "sys-secret"],
        assertAddedReadable: deny,
      }),
    ).rejects.toThrow(/forbidden/i);
    // The prior set is untouched (delete+insert happens AFTER the gate).
    expect((await service.listSystemLinks({ streamId: STREAM })).systemIds).toEqual([
      "sys-a",
    ]);
  });

  it("setSystemLinks checks existence BEFORE the added-gate (NOT_FOUND, gate never called)", async () => {
    const service = buildService();
    const spy = mock<AssertAddedSystemsReadable>(async () => {});
    await expect(
      service.setSystemLinks({
        streamId: "ghost-stream",
        systemIds: ["sys-a"],
        assertAddedReadable: spy,
      }),
    ).rejects.toThrow(/not found/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it("listStreamsForSystem returns the linked streams with names (joined)", async () => {
    const { db } = test;
    await db.insert(schema.metricStreams).values({
      id: "stream-2",
      name: "Second stream",
      config: DEFAULT_METRIC_STREAM_CONFIG,
      createdAt: CREATED,
      updatedAt: CREATED,
    });
    const service = buildService();
    await service.setSystemLinks({
      streamId: STREAM,
      systemIds: ["sys-a"],
      assertAddedReadable: allowAll,
    });
    await service.setSystemLinks({
      streamId: "stream-2",
      systemIds: ["sys-a"],
      assertAddedReadable: allowAll,
    });

    const result = await service.listStreamsForSystem({ systemId: "sys-a" });
    // Ordered by name: "Second stream" < "Service IT".
    expect(result.streams).toEqual([
      { id: "stream-2", name: "Second stream" },
      { id: STREAM, name: "Service IT" },
    ]);
    // A system with no links resolves to nothing.
    expect(
      (await service.listStreamsForSystem({ systemId: "sys-none" })).streams,
    ).toEqual([]);
  });

  it("listLinkedStreamStatuses groups systems, attaches newest recent event, drops stale", async () => {
    const { db } = test;
    const nowTs = new Date("2026-02-01T12:00:00.000Z");
    const service = buildService({ now: () => nowTs });
    await service.setSystemLinks({
      streamId: STREAM,
      systemIds: ["sys-a", "sys-b"],
      assertAddedReadable: allowAll,
    });

    // Two events: a stale one (>24h old, must be ignored) and a recent newest one.
    await db.insert(schema.metricImportantEvents).values([
      {
        id: "evt-stale",
        streamId: STREAM,
        ts: new Date("2026-01-30T00:00:00.000Z"),
        type: "series_cap" as const,
        title: "old",
      },
      {
        id: "evt-recent-old",
        streamId: STREAM,
        ts: new Date("2026-02-01T06:00:00.000Z"),
        type: "silence" as const,
        title: "recent but not newest",
      },
      {
        id: "evt-recent-new",
        streamId: STREAM,
        ts: new Date("2026-02-01T11:00:00.000Z"),
        type: "scrape_failing" as const,
        title: "newest recent",
      },
    ]);

    const result = await service.listLinkedStreamStatuses({
      systemIds: ["sys-a", "sys-b"],
    });
    expect(result.matches).toHaveLength(1);
    const match = result.matches[0]!;
    expect(match.id).toBe(STREAM);
    expect(match.name).toBe("Service IT");
    expect([...match.systemIds].sort()).toEqual(["sys-a", "sys-b"]);
    // Newest RECENT event within 24h wins; the stale one is excluded.
    expect(match.lastImportantEvent).toEqual({
      type: "scrape_failing",
      ts: new Date("2026-02-01T11:00:00.000Z"),
    });
  });

  it("listLinkedStreamStatuses returns null event when none in the 24h window", async () => {
    const { db } = test;
    const nowTs = new Date("2026-02-01T12:00:00.000Z");
    const service = buildService({ now: () => nowTs });
    await service.setSystemLinks({
      streamId: STREAM,
      systemIds: ["sys-a"],
      assertAddedReadable: allowAll,
    });
    await db.insert(schema.metricImportantEvents).values({
      id: "evt-stale-only",
      streamId: STREAM,
      ts: new Date("2026-01-01T00:00:00.000Z"),
      type: "series_cap" as const,
      title: "way old",
    });
    const result = await service.listLinkedStreamStatuses({ systemIds: ["sys-a"] });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.lastImportantEvent).toBeNull();
    // Empty request short-circuits.
    expect((await service.listLinkedStreamStatuses({ systemIds: [] })).matches).toEqual(
      [],
    );
  });

  it("listLinkedStreamStatuses: a benign NEWER event does not MASK an active failure", async () => {
    const { db } = test;
    const nowTs = new Date("2026-02-01T12:00:00.000Z");
    const service = buildService({ now: () => nowTs });
    await service.setSystemLinks({
      streamId: STREAM,
      systemIds: ["sys-a"],
      assertAddedReadable: allowAll,
    });
    // A scrape_failing, then a NEWER silence_recovered. Without the type filter
    // the recovery (newest of ANY type) would win and the deriver would emit no
    // signal - hiding the active failure. The filter constrains the lookup to
    // signal-worthy types, so the scrape_failing surfaces.
    await db.insert(schema.metricImportantEvents).values([
      {
        id: "evt-failing",
        streamId: STREAM,
        ts: new Date("2026-02-01T10:00:00.000Z"),
        type: "scrape_failing" as const,
        title: "scrape failing",
      },
      {
        id: "evt-recovered",
        streamId: STREAM,
        ts: new Date("2026-02-01T11:30:00.000Z"),
        type: "silence_recovered" as const,
        title: "benign newer recovery",
      },
    ]);
    const result = await service.listLinkedStreamStatuses({ systemIds: ["sys-a"] });
    expect(result.matches[0]!.lastImportantEvent).toEqual({
      type: "scrape_failing",
      ts: new Date("2026-02-01T10:00:00.000Z"),
    });
  });
});
