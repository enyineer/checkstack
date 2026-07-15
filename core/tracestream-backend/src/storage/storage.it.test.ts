import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import path from "node:path";
import { sql } from "drizzle-orm";
import {
  withTestDb,
  isIntegrationEnabled,
  type TestDb,
} from "@checkstack/test-utils-backend";
import { TraceStreamConfigSchema } from "@checkstack/tracestream-common";
import * as schema from "../schema";
import { createStorage, type Storage } from ".";
import { createImportantEventRecorder } from "../events/recorder";
import { decideStream } from "../health/decision-job";
import { runHotSweepPass } from "../health/retention";
import type {
  InsertSpanInput,
  SummaryFlushInput,
  OpBucketFoldInput,
} from ".";

const MIGRATIONS = path.join(import.meta.dir, "..", "..", "drizzle");

function span(over: Partial<InsertSpanInput> & { streamId: string; traceId: string; spanId: string; startTs: Date }): InsertSpanInput {
  return {
    parentSpanId: null,
    name: "op",
    kind: "server",
    serviceName: "svc",
    durationMs: 10,
    statusCode: "ok",
    statusMessage: null,
    attributes: null,
    events: null,
    links: null,
    resourceAttributes: null,
    ...over,
  };
}

function flush(over: Partial<SummaryFlushInput> & { streamId: string; traceId: string; startTs: Date; lastSpanAt: Date }): SummaryFlushInput {
  return {
    spanCount: 1,
    errorSpanCount: 0,
    hasError: false,
    rootServiceName: null,
    rootSpanName: null,
    ...over,
  };
}

describe.skipIf(!isIntegrationEnabled())("tracestream storage (integration)", () => {
  let test: TestDb<typeof schema>;
  let storage: Storage;

  beforeAll(async () => {
    test = await withTestDb({ schema, migrationsFolder: MIGRATIONS });
    storage = createStorage({ db: test.db });
  });
  afterAll(async () => {
    await test.dispose();
  });

  it("accumulates a trace summary across flushes (extent, counts, root)", async () => {
    const streamId = "agg-stream";
    const t0 = new Date("2026-07-14T10:00:00.000Z");
    // Flush 1: no root, 2 spans, ends at +100ms.
    await storage.summaries.upsertFromFlush({
      summaries: [
        flush({
          streamId,
          traceId: "tr",
          startTs: t0,
          lastSpanAt: new Date(t0.getTime() + 100),
          spanCount: 2,
        }),
      ],
    });
    // Flush 2: earlier start (-50ms), later end (+300ms), the root, an error.
    await storage.summaries.upsertFromFlush({
      summaries: [
        flush({
          streamId,
          traceId: "tr",
          startTs: new Date(t0.getTime() - 50),
          lastSpanAt: new Date(t0.getTime() + 300),
          spanCount: 1,
          errorSpanCount: 1,
          hasError: true,
          rootServiceName: "svc",
          rootSpanName: "GET /",
        }),
      ],
    });

    const summary = await storage.summaries.getSummary({ streamId, traceId: "tr" });
    expect(summary).not.toBeNull();
    expect(summary?.startTs.toISOString()).toBe(new Date(t0.getTime() - 50).toISOString());
    expect(summary?.lastSpanAt.toISOString()).toBe(new Date(t0.getTime() + 300).toISOString());
    // Union extent = (+300) - (-50) = 350ms.
    expect(summary?.durationMs).toBeCloseTo(350, 3);
    expect(summary?.spanCount).toBe(3);
    expect(summary?.errorSpanCount).toBe(1);
    expect(summary?.hasError).toBe(true);
    expect(summary?.rootServiceName).toBe("svc");
    expect(summary?.rootSpanName).toBe("GET /");
    expect(summary?.retained).toBeNull();
  });

  it("stores spans and derives endTs from the duration on read", async () => {
    const streamId = "span-stream";
    const t0 = new Date("2026-07-14T10:00:00.000Z");
    await storage.spans.insertSpans({
      spans: [
        span({ streamId, traceId: "tr", spanId: "a", startTs: t0, durationMs: 25 }),
        span({
          streamId,
          traceId: "tr",
          spanId: "b",
          parentSpanId: "a",
          startTs: new Date(t0.getTime() + 5),
          durationMs: 5,
        }),
      ],
    });
    const spans = await storage.spans.listSpansForTrace({ streamId, traceId: "tr" });
    expect(spans).toHaveLength(2);
    expect(spans[0].spanId).toBe("a");
    expect(spans[0].endTs.toISOString()).toBe(new Date(t0.getTime() + 25).toISOString());
  });

  it("insertSpans is idempotent: dedupes intra-batch and skips already-stored keys", async () => {
    const streamId = "idem-stream";
    const t0 = new Date("2026-07-14T10:00:00.000Z");

    // First delivery of two distinct spans: both are newly inserted.
    const firstKeys = await storage.spans.insertSpans({
      spans: [
        span({ streamId, traceId: "tr", spanId: "a", startTs: t0 }),
        span({ streamId, traceId: "tr", spanId: "b", startTs: t0 }),
      ],
    });
    expect(firstKeys.map((k) => k.spanId).toSorted()).toEqual(["a", "b"]);

    // Re-delivery of "a" plus a NEW "c", with an intra-batch duplicate of "c":
    // "a" is skipped (already stored), the duplicate "c" is collapsed, so only a
    // single "c" is reported as inserted.
    const secondKeys = await storage.spans.insertSpans({
      spans: [
        span({ streamId, traceId: "tr", spanId: "a", startTs: t0 }),
        span({ streamId, traceId: "tr", spanId: "c", startTs: t0 }),
        span({ streamId, traceId: "tr", spanId: "c", startTs: t0 }),
      ],
    });
    expect(secondKeys.map((k) => k.spanId)).toEqual(["c"]);

    // The store holds exactly one row per (traceId, spanId): a, b, c.
    const stored = await storage.spans.listSpansForTrace({ streamId, traceId: "tr" });
    expect(stored.map((s) => s.spanId).toSorted()).toEqual(["a", "b", "c"]);
  });

  it("decides settled traces per policy and is idempotent on re-run", async () => {
    const streamId = "decide-stream";
    const now = new Date("2026-07-14T12:00:00.000Z");
    const settled = new Date(now.getTime() - 5 * 60_000); // well past the grace
    const config = TraceStreamConfigSchema.parse({
      completionGraceSeconds: 30,
      sampling: {
        keepErrorTraces: true,
        slowTraceThresholdMs: 1000,
        baselineSampleRate: 0, // no baseline noise, so the outcome is deterministic
      },
    });

    await storage.summaries.upsertFromFlush({
      summaries: [
        flush({ streamId, traceId: "err", startTs: settled, lastSpanAt: new Date(settled.getTime() + 5), hasError: true, errorSpanCount: 1 }),
        flush({ streamId, traceId: "slow", startTs: settled, lastSpanAt: new Date(settled.getTime() + 2000) }),
        flush({ streamId, traceId: "drop1", startTs: settled, lastSpanAt: new Date(settled.getTime() + 5) }),
        flush({ streamId, traceId: "drop2", startTs: settled, lastSpanAt: new Date(settled.getTime() + 5) }),
      ],
    });

    const first = await decideStream({ storage, streamId, config, now });
    expect(first).toEqual({ retained: 2, dropped: 2 });
    expect((await storage.summaries.getSummary({ streamId, traceId: "err" }))?.retained).toBe(true);
    expect((await storage.summaries.getSummary({ streamId, traceId: "slow" }))?.retained).toBe(true);
    expect((await storage.summaries.getSummary({ streamId, traceId: "drop1" }))?.retained).toBe(false);
    expect((await storage.summaries.getSummary({ streamId, traceId: "drop2" }))?.retained).toBe(false);

    // Re-run: nothing is undecided anymore, so it is a no-op.
    const second = await decideStream({ storage, streamId, config, now });
    expect(second).toEqual({ retained: 0, dropped: 0 });
  });

  it("hot-sweeps unretained spans past the hot window, keeping retained + recent", async () => {
    const now = new Date();
    const stream = await storage.streams.create({ name: "sweep" }); // default 6h hot
    const streamId = stream.id;
    const old = new Date(now.getTime() - 7 * 3_600_000); // older than 6h
    const recent = new Date(now.getTime() - 1 * 3_600_000);

    // Three traces: old+unretained (swept), old+retained (kept), recent+unretained (kept).
    for (const [traceId, at, retained] of [
      ["old-unret", old, false],
      ["old-ret", old, true],
      ["recent-unret", recent, false],
    ] as const) {
      await storage.summaries.upsertFromFlush({
        summaries: [flush({ streamId, traceId, startTs: at, lastSpanAt: at })],
      });
      await storage.summaries.markDecided({ streamId, traceIds: [traceId], retained, decidedAt: now });
      await storage.spans.insertSpans({
        spans: [span({ streamId, traceId, spanId: `${traceId}-s`, startTs: at })],
      });
    }

    await runHotSweepPass({ storage, logger: silentLogger(), now });

    expect(await storage.spans.listSpansForTrace({ streamId, traceId: "old-unret" })).toHaveLength(0);
    expect(await storage.spans.listSpansForTrace({ streamId, traceId: "old-ret" })).toHaveLength(1);
    expect(await storage.spans.listSpansForTrace({ streamId, traceId: "recent-unret" })).toHaveLength(1);
  });

  it("rolls minute op buckets up to hourly and is idempotent on retry", async () => {
    const streamId = "rollup-stream";
    const now = new Date();
    const minuteCutoff = new Date(now.getTime() - 48 * 3_600_000);
    const bucketStart = new Date(now.getTime() - 50 * 3_600_000); // older than the cutoff
    const hourStart = new Date(Math.floor(bucketStart.getTime() / 3_600_000) * 3_600_000);
    const fold: OpBucketFoldInput = {
      streamId,
      serviceName: "svc",
      spanName: "op",
      bucketStart,
      durationsMs: [5, 10, 20, 30, 40],
      errorCount: 1,
    };
    await storage.opBuckets.foldSpans({ folds: [fold] });

    const firstFolded = await storage.opBuckets.rollupMinuteToHourly({ streamId, minuteCutoff });
    expect(firstFolded).toBe(1);
    // A retry has nothing left to fold (minute rows already deleted) => no double count.
    const secondFolded = await storage.opBuckets.rollupMinuteToHourly({ streamId, minuteCutoff });
    expect(secondFolded).toBe(0);

    const hourly = await storage.opBuckets.queryBuckets({
      streamId,
      serviceName: "svc",
      spanName: "op",
      from: hourStart,
      to: new Date(hourStart.getTime() + 3_600_000),
      grain: "hour",
    });
    expect(hourly).toHaveLength(1);
    expect(hourly[0].spanCount).toBe(5);
    expect(hourly[0].errorCount).toBe(1);
    expect(hourly[0].durMaxMs).toBe(40);
    // The digest survives the minute->hour rollup, so p95 is still real.
    expect(hourly[0].p95Ms).not.toBeNull();
    expect(hourly[0].p95Ms!).toBeGreaterThanOrEqual(30);
    expect(hourly[0].p95Ms!).toBeLessThanOrEqual(40);
  });

  it("folds span durations into a p95 digest and reads back a real p95", async () => {
    const streamId = "p95-stream";
    const now = new Date();
    const bucketStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    // 100 spans 1..100ms; p95 should be ~95.
    const durationsMs = Array.from({ length: 100 }, (_, i) => i + 1);
    await storage.opBuckets.foldSpans({
      folds: [{ streamId, serviceName: "svc", spanName: "op", bucketStart, durationsMs, errorCount: 0 }],
    });
    const buckets = await storage.opBuckets.queryBuckets({
      streamId,
      serviceName: "svc",
      spanName: "op",
      from: bucketStart,
      to: new Date(bucketStart.getTime() + 60_000),
      grain: "minute",
    });
    expect(buckets).toHaveLength(1);
    expect(buckets[0].spanCount).toBe(100);
    expect(buckets[0].p95Ms).not.toBeNull();
    expect(buckets[0].p95Ms!).toBeGreaterThanOrEqual(90);
    expect(buckets[0].p95Ms!).toBeLessThanOrEqual(100);
  });

  it("accumulates the digest across multiple flushes into the same bucket", async () => {
    const streamId = "p95-multiflush";
    const now = new Date();
    const bucketStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    // Two flushes, 50 spans each (1..50 then 51..100) into the SAME bucket.
    await storage.opBuckets.foldSpans({
      folds: [{ streamId, serviceName: "svc", spanName: "op", bucketStart, durationsMs: Array.from({ length: 50 }, (_, i) => i + 1), errorCount: 0 }],
    });
    await storage.opBuckets.foldSpans({
      folds: [{ streamId, serviceName: "svc", spanName: "op", bucketStart, durationsMs: Array.from({ length: 50 }, (_, i) => i + 51), errorCount: 0 }],
    });
    const [bucket] = await storage.opBuckets.queryBuckets({
      streamId,
      serviceName: "svc",
      spanName: "op",
      from: bucketStart,
      to: new Date(bucketStart.getTime() + 60_000),
      grain: "minute",
    });
    // Merge-on-write kept BOTH flushes' samples, so span count is 100 and p95 ~95.
    expect(bucket.spanCount).toBe(100);
    expect(bucket.p95Ms!).toBeGreaterThanOrEqual(90);
    expect(bucket.p95Ms!).toBeLessThanOrEqual(100);
  });

  it("queryWindowLatency merges digests ACROSS buckets for one window p95", async () => {
    const streamId = "p95-window";
    const now = new Date();
    const minuteA = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    const minuteB = new Date(minuteA.getTime() + 60_000);
    // Split 1..100ms across TWO minute buckets: 1..50 in A, 51..100 in B. Each
    // bucket's OWN p95 is ~48 / ~98; the correct WINDOW p95 (over all 100
    // samples) is ~95 - which averaging per-bucket p95s (~73) would never give.
    await storage.opBuckets.foldSpans({
      folds: [
        { streamId, serviceName: "svc", spanName: "op", bucketStart: minuteA, durationsMs: Array.from({ length: 50 }, (_, i) => i + 1), errorCount: 2 },
        { streamId, serviceName: "svc", spanName: "op", bucketStart: minuteB, durationsMs: Array.from({ length: 50 }, (_, i) => i + 51), errorCount: 3 },
      ],
    });
    const window = await storage.opBuckets.queryWindowLatency({
      streamId,
      serviceName: "svc",
      spanName: "op",
      from: minuteA,
      to: new Date(minuteB.getTime() + 60_000),
      grain: "minute",
    });
    expect(window.spanCount).toBe(100);
    expect(window.errorCount).toBe(5);
    expect(window.durMinMs).toBe(1);
    expect(window.durMaxMs).toBe(100);
    expect(window.p95Ms).not.toBeNull();
    expect(window.p95Ms!).toBeGreaterThanOrEqual(90);
    expect(window.p95Ms!).toBeLessThanOrEqual(100);
  });

  it("queryWindowLatency returns all-zero for an empty window", async () => {
    const streamId = "p95-window-empty";
    const now = new Date();
    const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    const window = await storage.opBuckets.queryWindowLatency({
      streamId,
      serviceName: "absent",
      from: minute,
      to: new Date(minute.getTime() + 60_000),
      grain: "minute",
    });
    expect(window.spanCount).toBe(0);
    expect(window.errorCount).toBe(0);
    expect(window.p95Ms).toBeNull();
  });

  it("sumWindowCounts sums span + error counts across buckets in SQL", async () => {
    const streamId = "sum-window";
    const now = new Date();
    const minuteA = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    const minuteB = new Date(minuteA.getTime() + 60_000);
    await storage.opBuckets.foldSpans({
      folds: [
        { streamId, serviceName: "svc", spanName: "op", bucketStart: minuteA, durationsMs: [1, 2, 3], errorCount: 1 },
        { streamId, serviceName: "svc", spanName: "op", bucketStart: minuteB, durationsMs: [4, 5], errorCount: 2 },
        // A DIFFERENT service in the same minute also folds into the window total.
        { streamId, serviceName: "other", spanName: "op", bucketStart: minuteB, durationsMs: [6], errorCount: 1 },
      ],
    });
    const totals = await storage.opBuckets.sumWindowCounts({
      streamId,
      from: minuteA,
      to: new Date(minuteB.getTime() + 60_000),
      grain: "minute",
    });
    expect(totals.spanCount).toBe(6); // 3 + 2 + 1
    expect(totals.errorSpanCount).toBe(4); // 1 + 2 + 1
  });

  it("sumWindowCounts returns zeros for an empty window", async () => {
    const streamId = "sum-window-empty";
    const now = new Date();
    const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    const totals = await storage.opBuckets.sumWindowCounts({
      streamId,
      from: minute,
      to: new Date(minute.getTime() + 60_000),
      grain: "minute",
    });
    expect(totals).toEqual({ spanCount: 0, errorSpanCount: 0 });
  });

  it("returns null p95 for a legacy bucket row with no digest, merged with real ones", async () => {
    const streamId = "p95-mixed";
    const now = new Date();
    const bA = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    const bB = new Date(bA.getTime() - 60_000);
    // Bucket A: real digest via foldSpans.
    await storage.opBuckets.foldSpans({
      folds: [{ streamId, serviceName: "svc", spanName: "op", bucketStart: bA, durationsMs: [10, 20, 30], errorCount: 0 }],
    });
    // Bucket B: a pre-upgrade row inserted directly with NO digest (null).
    await test.db.insert(schema.traceOpMinuteBuckets).values({
      streamId,
      serviceName: "svc",
      spanName: "op",
      bucketStart: bB,
      spanCount: 3,
      errorCount: 0,
      durSumMs: 60,
      durMinMs: 10,
      durMaxMs: 30,
      digest: null,
    });
    const buckets = await storage.opBuckets.queryBuckets({
      streamId,
      serviceName: "svc",
      spanName: "op",
      from: bB,
      to: new Date(bA.getTime() + 60_000),
      grain: "minute",
    });
    const byTime = new Map(buckets.map((b) => [b.bucketStart.getTime(), b]));
    expect(byTime.get(bA.getTime())?.p95Ms).not.toBeNull();
    expect(byTime.get(bB.getTime())?.p95Ms).toBeNull();
  });

  it("enforces service and operation caps and reports the drops", async () => {
    const streamId = "cap-stream";
    const now = new Date();
    const serviceDrops = await storage.serviceOps.touch({
      streamId,
      serviceCap: 1,
      operationCapPerService: 10,
      entries: [
        { serviceName: "svcA", spanName: "op1", kind: "server", seenAt: now },
        { serviceName: "svcB", spanName: "op1", kind: "server", seenAt: now },
      ],
    });
    expect(serviceDrops.droppedServices).toBe(1);
    expect((await storage.serviceOps.listServices({ streamId })).map((s) => s.serviceName)).toEqual(["svcA"]);

    const opDrops = await storage.serviceOps.touch({
      streamId,
      serviceCap: 10,
      operationCapPerService: 1,
      entries: [
        { serviceName: "svcA", spanName: "op1", kind: "server", seenAt: now },
        { serviceName: "svcA", spanName: "op2", kind: "server", seenAt: now },
      ],
    });
    expect(opDrops.droppedOperations).toBe(1);
    expect(await storage.serviceOps.listOperations({ streamId, serviceName: "svcA" })).toHaveLength(1);
  });

  it("pages important events by keyset without skipping same-millisecond rows", async () => {
    const streamId = "events-keyset";
    // Five events all at the SAME ts: an offset-by-ts cursor would skip or repeat
    // rows across the page boundary; the (ts, id) keyset must return all five.
    const ts = new Date("2026-07-14T09:00:00.000Z");
    for (let i = 0; i < 5; i++) {
      await storage.importantEvents.insert({
        streamId,
        ts,
        type: "rate_limited",
        title: `evt-${i}`,
      });
    }

    const seen: string[] = [];
    let cursor: { ts: Date; id: string } | undefined;
    let pages = 0;
    for (;;) {
      const page = await storage.importantEvents.list({
        streamId,
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
    expect(new Set(seen).size).toBe(5); // every row exactly once, none skipped
  });

  it("lastEventAt returns the newest event ts of a type, filtered + isolated per stream", async () => {
    // lastEventAt is the CLUSTER-WIDE error-spike dedupe read - assert its
    // ordering (newest), type filter, stream isolation, and null-when-none.
    const streamA = "last-event-a";
    const streamB = "last-event-b";
    const older = new Date("2026-07-14T10:00:00.000Z");
    const newer = new Date("2026-07-14T10:05:00.000Z");
    await storage.importantEvents.insert({ streamId: streamA, ts: older, type: "error_spike", title: "old" });
    await storage.importantEvents.insert({ streamId: streamA, ts: newer, type: "error_spike", title: "new" });
    // A different type on the SAME stream must not be returned.
    await storage.importantEvents.insert({ streamId: streamA, ts: new Date("2026-07-14T11:00:00.000Z"), type: "silence", title: "silence" });
    // A spike on ANOTHER stream must not leak across the isolation boundary.
    await storage.importantEvents.insert({ streamId: streamB, ts: new Date("2026-07-14T12:00:00.000Z"), type: "error_spike", title: "other" });

    expect(
      await storage.importantEvents.lastEventAt({ streamId: streamA, type: "error_spike" }),
    ).toEqual(newer);
    expect(
      await storage.importantEvents.lastEventAt({ streamId: streamB, type: "error_spike" }),
    ).toEqual(new Date("2026-07-14T12:00:00.000Z"));
    expect(
      await storage.importantEvents.lastEventAt({ streamId: streamA, type: "rate_limited" }),
    ).toBeNull();
    expect(
      await storage.importantEvents.lastEventAt({ streamId: "no-such-stream", type: "error_spike" }),
    ).toBeNull();
  });

  it("counts retained traces per UTC hour regardless of the session time zone", async () => {
    const streamId = "tz-hours";
    // Shift the session to a half-hour-offset zone: date_trunc('hour', ...) would
    // bucket on local (xx:30) boundaries and never match the UTC hour keys.
    await test.db.execute(sql`SET TIME ZONE 'Asia/Kolkata'`);
    try {
      const h0 = new Date("2026-07-14T08:00:00.000Z"); // exact UTC hour
      const h1 = new Date("2026-07-14T09:00:00.000Z");
      // Two retained traces in hour h0, one in h1.
      const flushes: SummaryFlushInput[] = [
        flush({ streamId, traceId: "a", startTs: new Date(h0.getTime() + 5 * 60_000), lastSpanAt: h0 }),
        flush({ streamId, traceId: "b", startTs: new Date(h0.getTime() + 40 * 60_000), lastSpanAt: h0 }),
        flush({ streamId, traceId: "c", startTs: new Date(h1.getTime() + 10 * 60_000), lastSpanAt: h1 }),
      ];
      await storage.summaries.upsertFromFlush({ summaries: flushes });
      await storage.summaries.markDecided({
        streamId,
        traceIds: ["a", "b", "c"],
        retained: true,
        decidedAt: new Date(),
      });

      const counts = await storage.summaries.countRetainedByHour({
        streamId,
        hourStarts: [h0, h1],
      });
      expect(counts.get(h0.getTime())).toBe(2);
      expect(counts.get(h1.getTime())).toBe(1);
    } finally {
      await test.db.execute(sql`SET TIME ZONE 'UTC'`);
    }
  });

  it("cascades deleteStreamData across every table", async () => {
    const stream = await storage.streams.create({ name: "cascade" });
    const streamId = stream.id;
    const now = new Date();
    await storage.tokens.insert({ streamId, name: "t", tokenHash: "h", tokenPrefix: "cktr_xyz" });
    await storage.spans.insertSpans({ spans: [span({ streamId, traceId: "tr", spanId: "s", startTs: now })] });
    await storage.summaries.upsertFromFlush({ summaries: [flush({ streamId, traceId: "tr", startTs: now, lastSpanAt: now })] });
    await storage.opBuckets.foldSpans({ folds: [{ streamId, serviceName: "svc", spanName: "op", bucketStart: now, durationsMs: [1], errorCount: 0 }] });
    await storage.serviceOps.touch({ streamId, serviceCap: 10, operationCapPerService: 10, entries: [{ serviceName: "svc", spanName: "op", kind: "server", seenAt: now }] });
    await storage.activity.touch({ streamId, receivedAt: now, rateEstimate: 1 });
    await storage.importantEvents.insert({ streamId, ts: now, type: "silence", title: "x" });
    await storage.systemLinks.setSystemLinks({ streamId, systemIds: ["sys-1"] });

    await storage.deleteStreamData({ streamId });

    expect(await storage.tokens.list({ streamId })).toHaveLength(0);
    expect(await storage.spans.listSpansForTrace({ streamId, traceId: "tr" })).toHaveLength(0);
    expect(await storage.summaries.getSummary({ streamId, traceId: "tr" })).toBeNull();
    expect(await storage.serviceOps.listServices({ streamId })).toHaveLength(0);
    expect(await storage.activity.read({ streamId })).toBeNull();
    expect((await storage.importantEvents.list({ streamId, limit: 10 })).events).toHaveLength(0);
    expect(await storage.systemLinks.listSystemIdsForStream({ streamId })).toHaveLength(0);
  });

  it("replaces a stream's linked-system set (replace-all, deduped, idempotent)", async () => {
    const stream = await storage.streams.create({ name: "links" });
    const streamId = stream.id;

    // Duplicate ids in the set collapse via the PK.
    await storage.systemLinks.setSystemLinks({
      streamId,
      systemIds: ["sys-a", "sys-b", "sys-a"],
    });
    expect(
      await storage.systemLinks.listSystemIdsForStream({ streamId }),
    ).toEqual(["sys-a", "sys-b"]);

    // A second set REPLACES the whole set (removes sys-a, adds sys-c).
    await storage.systemLinks.setSystemLinks({
      streamId,
      systemIds: ["sys-b", "sys-c"],
    });
    expect(
      await storage.systemLinks.listSystemIdsForStream({ streamId }),
    ).toEqual(["sys-b", "sys-c"]);

    // An empty set clears every link.
    await storage.systemLinks.setSystemLinks({ streamId, systemIds: [] });
    expect(
      await storage.systemLinks.listSystemIdsForStream({ streamId }),
    ).toHaveLength(0);
  });

  it("lists streams linked to a system, id+name, ordered by name", async () => {
    const alpha = await storage.streams.create({ name: "Alpha traces" });
    const zeta = await storage.streams.create({ name: "Zeta traces" });
    const other = await storage.streams.create({ name: "Unlinked" });
    await storage.systemLinks.setSystemLinks({
      streamId: zeta.id,
      systemIds: ["sys-shared"],
    });
    await storage.systemLinks.setSystemLinks({
      streamId: alpha.id,
      systemIds: ["sys-shared"],
    });
    await storage.systemLinks.setSystemLinks({
      streamId: other.id,
      systemIds: ["sys-elsewhere"],
    });

    const streams = await storage.systemLinks.listStreamsForSystem({
      systemId: "sys-shared",
    });
    // Ordered by name (Alpha before Zeta); the unrelated stream is excluded.
    expect(streams).toEqual([
      { id: alpha.id, name: "Alpha traces" },
      { id: zeta.id, name: "Zeta traces" },
    ]);
  });

  it("bulk statuses: newest recent event per stream, 24h-bounded, regrouped by system", async () => {
    const s1 = await storage.streams.create({ name: "S1" });
    const s2 = await storage.streams.create({ name: "S2" });
    const s3 = await storage.streams.create({ name: "S3" });
    // s1 -> sysA + sysB; s2 -> sysA; s3 -> sysC (not requested below).
    await storage.systemLinks.setSystemLinks({
      streamId: s1.id,
      systemIds: ["sysA", "sysB"],
    });
    await storage.systemLinks.setSystemLinks({
      streamId: s2.id,
      systemIds: ["sysA"],
    });
    await storage.systemLinks.setSystemLinks({
      streamId: s3.id,
      systemIds: ["sysC"],
    });

    const nowTs = new Date("2026-07-14T12:00:00.000Z");
    const since = new Date(nowTs.getTime() - 24 * 3_600_000);
    // s1: an OLD event (outside 24h) and a NEWER one (inside) - newest-in-window wins.
    await storage.importantEvents.insert({
      streamId: s1.id,
      ts: new Date("2026-07-13T11:00:00.000Z"), // >24h before nowTs -> excluded
      type: "silence",
      title: "old",
    });
    await storage.importantEvents.insert({
      streamId: s1.id,
      ts: new Date("2026-07-14T10:00:00.000Z"), // inside window
      type: "error_spike",
      title: "recent",
    });
    // s2: only a stale event (outside the window) -> null lastImportantEvent.
    await storage.importantEvents.insert({
      streamId: s2.id,
      ts: new Date("2026-07-12T00:00:00.000Z"),
      type: "error_spike",
      title: "stale",
    });

    const matches = await storage.systemLinks.listLinkedStreamStatuses({
      systemIds: ["sysA", "sysB"],
      since,
    });
    const byId = new Map(matches.map((m) => [m.id, m]));
    // s3 links only sysC (not requested) -> absent.
    expect([...byId.keys()].sort()).toEqual([s1.id, s2.id].sort());
    // s1's newest in-window event is the error_spike; systemIds regrouped.
    expect(byId.get(s1.id)!.lastImportantEvent?.type).toBe("error_spike");
    expect(byId.get(s1.id)!.systemIds.sort()).toEqual(["sysA", "sysB"]);
    // s2's only event is older than 24h -> null; still linked to sysA.
    expect(byId.get(s2.id)!.lastImportantEvent).toBeNull();
    expect(byId.get(s2.id)!.systemIds).toEqual(["sysA"]);
  });

  it("bulk statuses never surface a phantom link whose stream row is gone", async () => {
    const live = await storage.streams.create({ name: "Live" });
    const gone = await storage.streams.create({ name: "Doomed" });
    await storage.systemLinks.setSystemLinks({
      streamId: live.id,
      systemIds: ["sysP"],
    });
    await storage.systemLinks.setSystemLinks({
      streamId: gone.id,
      systemIds: ["sysP"],
    });
    // Delete ONLY the stream row (simulating a partial delete before the link
    // sweep runs); the link row for `gone` is now a phantom.
    await storage.streams.delete({ id: gone.id });

    const matches = await storage.systemLinks.listLinkedStreamStatuses({
      systemIds: ["sysP"],
      since: new Date("2000-01-01T00:00:00.000Z"),
    });
    // Only the live stream is surfaced; the phantom is dropped (no raw-UUID row).
    expect(matches.map((m) => m.id)).toEqual([live.id]);
  });

  it("bulk statuses: a newer NON-signal event never masks a recent error_spike", async () => {
    const stream = await storage.streams.create({ name: "Spiky" });
    const silent = await storage.streams.create({ name: "OnlySilence" });
    await storage.systemLinks.setSystemLinks({
      streamId: stream.id,
      systemIds: ["sysS"],
    });
    await storage.systemLinks.setSystemLinks({
      streamId: silent.id,
      systemIds: ["sysS"],
    });
    const base = new Date("2026-07-14T12:00:00.000Z");
    const since = new Date(base.getTime() - 24 * 3_600_000);
    // An error_spike, then a LATER rate_limited (a non-signal type). Without the
    // type filter the newest event (rate_limited) would mask the spike.
    await storage.importantEvents.insert({
      streamId: stream.id,
      ts: new Date(base.getTime() - 3_600_000),
      type: "error_spike",
      title: "spike",
    });
    await storage.importantEvents.insert({
      streamId: stream.id,
      ts: new Date(base.getTime() - 60_000),
      type: "rate_limited",
      title: "throttled",
    });
    // The silence-only stream must resolve to null (silence is not signal-worthy).
    await storage.importantEvents.insert({
      streamId: silent.id,
      ts: new Date(base.getTime() - 120_000),
      type: "silence",
      title: "quiet",
    });

    const matches = await storage.systemLinks.listLinkedStreamStatuses({
      systemIds: ["sysS"],
      since,
    });
    const byId = new Map(matches.map((m) => [m.id, m]));
    expect(byId.get(stream.id)!.lastImportantEvent?.type).toBe("error_spike");
    expect(byId.get(silent.id)!.lastImportantEvent).toBeNull();
  });

  it("accumulates satellite in-transit drops per stream, isolated across streams", async () => {
    const streamA = "in-transit-a";
    const streamB = "in-transit-b";

    // Upsert-increment: two writes to the same stream accumulate.
    await storage.activity.addInTransitDrops({ streamId: streamA, dropped: 3 });
    await storage.activity.addInTransitDrops({ streamId: streamA, dropped: 4 });
    // A different stream is charged independently.
    await storage.activity.addInTransitDrops({ streamId: streamB, dropped: 10 });
    // Non-positive counts are no-ops (no accidental row / decrement).
    await storage.activity.addInTransitDrops({ streamId: streamA, dropped: 0 });
    await storage.activity.addInTransitDrops({ streamId: streamA, dropped: -5 });

    const a = await storage.activity.read({ streamId: streamA });
    const b = await storage.activity.read({ streamId: streamB });
    expect(a?.droppedInTransitCount).toBe(7);
    expect(b?.droppedInTransitCount).toBe(10);
    // The drop counter upserts its own row without advancing receive activity.
    expect(a?.lastReceivedAt).toBeNull();
    expect(a?.approxSpansPerMinute).toBe(0);

    // A later `touch` advances receive activity but leaves the drop total intact.
    const now = new Date();
    await storage.activity.touch({ streamId: streamA, receivedAt: now, rateEstimate: 12 });
    const after = await storage.activity.read({ streamId: streamA });
    expect(after?.droppedInTransitCount).toBe(7);
    expect(after?.approxSpansPerMinute).toBe(12);
    expect(after?.lastReceivedAt?.getTime()).toBe(now.getTime());
  });

  it("records important events through the recorder (store + signal)", async () => {
    const streamId = "event-stream";
    const broadcasts: string[] = [];
    const recorder = createImportantEventRecorder({
      store: storage.importantEvents,
      signalService: {
        broadcast: async () => {
          broadcasts.push("x");
        },
      } as unknown as Parameters<typeof createImportantEventRecorder>[0]["signalService"],
      logger: silentLogger(),
    });
    await recorder.record({ streamId, ts: new Date(), type: "rate_limited", title: "slow down" });
    expect(broadcasts).toHaveLength(1);
    expect((await storage.importantEvents.list({ streamId, limit: 10 })).events).toHaveLength(1);
  });
});

function silentLogger() {
  const noop = () => {};
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
  } as unknown as Parameters<typeof runHotSweepPass>[0]["logger"];
}
