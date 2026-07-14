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

    await storage.deleteStreamData({ streamId });

    expect(await storage.tokens.list({ streamId })).toHaveLength(0);
    expect(await storage.spans.listSpansForTrace({ streamId, traceId: "tr" })).toHaveLength(0);
    expect(await storage.summaries.getSummary({ streamId, traceId: "tr" })).toBeNull();
    expect(await storage.serviceOps.listServices({ streamId })).toHaveLength(0);
    expect(await storage.activity.read({ streamId })).toBeNull();
    expect((await storage.importantEvents.list({ streamId, limit: 10 })).events).toHaveLength(0);
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
