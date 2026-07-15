import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import path from "node:path";
import {
  withTestDb,
  isIntegrationEnabled,
  createMockLogger,
  createMockSignalService,
  type TestDb,
} from "@checkstack/test-utils-backend";
import {
  DEFAULT_TRACE_STREAM_CONFIG,
  type TraceStreamConfig,
} from "@checkstack/tracestream-common";
import type { NormalizedSpan } from "@checkstack/telemetry-common";
import * as schema from "../schema";
import {
  createStorage,
  type Storage,
  type InsertSpanInput,
  type SummaryFlushInput,
} from "../storage";
import { createImportantEventRecorder } from "../events/recorder";
import { createIngestPipeline } from "./pipeline";

/** Poll until `cond` holds (for fire-and-forget writes) or time out. */
async function waitFor(
  cond: () => Promise<boolean>,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await cond()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const MIGRATIONS = path.join(import.meta.dir, "..", "..", "drizzle");

const TRACE_ID = "5b8aa5a2d2c872e8321cf37308d69df2";

function span(over: Partial<NormalizedSpan> & { spanId: string }): NormalizedSpan {
  const startTs = over.startTs ?? new Date();
  return {
    traceId: TRACE_ID,
    name: "op",
    kind: "server",
    startTs,
    endTs: over.endTs ?? new Date(startTs.getTime() + 25),
    resource: { serviceName: "checkout" },
    ...over,
  };
}

describe.skipIf(!isIntegrationEnabled())("tracestream ingest flush (integration)", () => {
  let test: TestDb<typeof schema>;
  let storage: Storage;

  beforeAll(async () => {
    test = await withTestDb({ schema, migrationsFolder: MIGRATIONS });
    storage = createStorage({ db: test.db });
  });
  afterAll(async () => {
    await test.dispose();
  });

  function pipelineFor() {
    const recorder = createImportantEventRecorder({
      store: storage.importantEvents,
      signalService: createMockSignalService(),
      logger: createMockLogger(),
    });
    return createIngestPipeline({
      storage,
      recorder,
      signalService: createMockSignalService(),
      logger: createMockLogger(),
      flushIntervalMs: 100_000,
    });
  }

  it("folds a flush into spans, summary, op buckets and the catalog", async () => {
    const streamId = "flush-stream";
    const config: TraceStreamConfig = DEFAULT_TRACE_STREAM_CONFIG;
    const now = new Date("2026-07-14T10:00:00.000Z");
    const pipeline = pipelineFor();

    pipeline.ingest({
      streamId,
      config,
      now,
      spans: [
        span({ spanId: "aaaaaaaaaaaaaaa1", parentSpanId: undefined, name: "POST /checkout", startTs: now, endTs: new Date(now.getTime() + 120) }),
        span({ spanId: "aaaaaaaaaaaaaaa2", parentSpanId: "aaaaaaaaaaaaaaa1", startTs: new Date(now.getTime() + 10), endTs: new Date(now.getTime() + 40), status: { code: "error" } }),
      ],
    });
    await pipeline.flushNow();
    pipeline.stop();

    const spans = await storage.spans.listSpansForTrace({ streamId, traceId: TRACE_ID });
    expect(spans).toHaveLength(2);

    const summary = await storage.summaries.getSummary({ streamId, traceId: TRACE_ID });
    expect(summary?.spanCount).toBe(2);
    expect(summary?.errorSpanCount).toBe(1);
    expect(summary?.hasError).toBe(true);
    expect(summary?.rootSpanName).toBe("POST /checkout");

    const services = await storage.serviceOps.listServices({ streamId });
    expect(services.map((s) => s.serviceName)).toContain("checkout");

    const topServices = await storage.opBuckets.topServices({
      streamId,
      since: new Date(now.getTime() - 60_000),
      limit: 10,
    });
    expect(topServices.find((s) => s.serviceName === "checkout")?.spanCount).toBe(2);

    const activity = await storage.activity.read({ streamId });
    expect(activity?.lastReceivedAt).not.toBeNull();
  });

  it("rolls the whole flush back on a mid-transaction failure (no partial rows)", async () => {
    const streamId = "atomic-stream";
    const traceId = "1111111111111111111111111111aaaa";
    const now = new Date("2026-07-14T11:00:00.000Z");
    const insert: InsertSpanInput = {
      streamId,
      traceId,
      spanId: "aaaaaaaaaaaaaaa1",
      parentSpanId: null,
      name: "op",
      kind: "server",
      serviceName: "svc",
      startTs: now,
      durationMs: 10,
      statusCode: "ok",
      statusMessage: null,
      attributes: null,
      events: null,
      links: null,
      resourceAttributes: null,
    };
    const summary: SummaryFlushInput = {
      streamId,
      traceId,
      startTs: now,
      lastSpanAt: new Date(now.getTime() + 10),
      spanCount: 1,
      errorSpanCount: 0,
      hasError: false,
      rootServiceName: "svc",
      rootSpanName: "op",
    };
    await expect(
      storage.withFlushTransaction(async (ports) => {
        await ports.spans.insertSpans({ spans: [insert] });
        await ports.summaries.upsertFromFlush({ summaries: [summary] });
        // Fail AFTER two partial writes; the transaction must roll both back.
        throw new Error("boom mid-flush");
      }),
    ).rejects.toThrow("boom mid-flush");

    expect(await storage.spans.listSpansForTrace({ streamId, traceId })).toHaveLength(0);
    expect(await storage.summaries.getSummary({ streamId, traceId })).toBeNull();
  });

  it("retries a failed flush once and commits exactly once (no double-fold)", async () => {
    const streamId = "retry-stream";
    const now = new Date("2026-07-14T11:30:00.000Z");
    let calls = 0;
    // Flaky storage: the FIRST transaction attempt fails (rolls back), the
    // second runs for real. A retry after an atomic rollback cannot double-fold.
    const flaky: Storage = {
      ...storage,
      withFlushTransaction: async (fn) => {
        calls += 1;
        if (calls === 1) throw new Error("transient");
        return storage.withFlushTransaction(fn);
      },
    };
    const pipeline = createIngestPipeline({
      storage: flaky,
      recorder: createImportantEventRecorder({
        store: storage.importantEvents,
        signalService: createMockSignalService(),
        logger: createMockLogger(),
      }),
      signalService: createMockSignalService(),
      logger: createMockLogger(),
      flushIntervalMs: 100_000,
    });
    pipeline.ingest({
      streamId,
      config: DEFAULT_TRACE_STREAM_CONFIG,
      now,
      spans: [
        span({ spanId: "bbbbbbbbbbbbbbb1", parentSpanId: undefined, startTs: now, endTs: new Date(now.getTime() + 20) }),
      ],
    });
    await pipeline.flushNow();
    pipeline.stop();

    expect(calls).toBe(2);
    const summary = await storage.summaries.getSummary({ streamId, traceId: TRACE_ID });
    expect(summary?.spanCount).toBe(1); // committed once, not doubled
    expect(await storage.spans.listSpansForTrace({ streamId, traceId: TRACE_ID })).toHaveLength(1);
  });

  it("re-flushing the same spans folds aggregates only over the newly-inserted subset", async () => {
    const streamId = "idem-flush-stream";
    const now = new Date("2026-07-14T11:45:00.000Z");
    const config: TraceStreamConfig = DEFAULT_TRACE_STREAM_CONFIG;
    const spans = [
      span({ spanId: "ddddddddddddddd1", parentSpanId: undefined, name: "GET /", startTs: now, endTs: new Date(now.getTime() + 30) }),
      span({ spanId: "ddddddddddddddd2", parentSpanId: "ddddddddddddddd1", startTs: new Date(now.getTime() + 5), endTs: new Date(now.getTime() + 20) }),
    ];

    // First delivery.
    const p1 = pipelineFor();
    p1.ingest({ streamId, config, now, spans });
    await p1.flushNow();
    p1.stop();

    // At-least-once re-delivery of the SAME spans (plus one genuinely new span).
    const p2 = pipelineFor();
    p2.ingest({
      streamId,
      config,
      now,
      spans: [
        ...spans,
        span({ spanId: "ddddddddddddddd3", parentSpanId: "ddddddddddddddd1", startTs: new Date(now.getTime() + 8), endTs: new Date(now.getTime() + 18) }),
      ],
    });
    await p2.flushNow();
    p2.stop();

    // Exactly three spans stored (no duplicate rows).
    const stored = await storage.spans.listSpansForTrace({ streamId, traceId: TRACE_ID });
    expect(stored.map((s) => s.spanId).toSorted()).toEqual([
      "ddddddddddddddd1",
      "ddddddddddddddd2",
      "ddddddddddddddd3",
    ]);

    // The summary counts each span once: 2 from the first flush + 1 new = 3,
    // NOT 2 + 3 (which is what re-folding the duplicates would produce).
    const summary = await storage.summaries.getSummary({ streamId, traceId: TRACE_ID });
    expect(summary?.spanCount).toBe(3);

    // The op buckets likewise reflect three spans total, not five.
    const bucketStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    const buckets = await storage.opBuckets.queryBuckets({
      streamId,
      serviceName: "checkout",
      from: bucketStart,
      to: new Date(bucketStart.getTime() + 60_000),
      grain: "minute",
    });
    const total = buckets.reduce((n, b) => n + b.spanCount, 0);
    expect(total).toBe(3);
  });

  it("records span_bytes_exceeded and drops payloads over maxSpanBytes", async () => {
    const streamId = "bytecap-stream";
    const now = new Date("2026-07-14T12:00:00.000Z");
    const config: TraceStreamConfig = { ...DEFAULT_TRACE_STREAM_CONFIG, maxSpanBytes: 256 };
    const pipeline = pipelineFor();
    pipeline.ingest({
      streamId,
      config,
      now,
      spans: [
        span({
          spanId: "ccccccccccccccc1",
          parentSpanId: undefined,
          startTs: now,
          endTs: new Date(now.getTime() + 15),
          attributes: { big: "x".repeat(2000) },
        }),
      ],
    });
    await pipeline.flushNow();
    pipeline.stop();

    // The span is stored but its oversized payload was dropped.
    const spans = await storage.spans.listSpansForTrace({ streamId, traceId: TRACE_ID });
    expect(spans).toHaveLength(1);
    expect(spans[0].attributes).toBeNull();
    // The event is recorded fire-and-forget from ingest; poll for it.
    await waitFor(async () =>
      (await storage.importantEvents.list({ streamId, limit: 10 })).events.some(
        (e) => e.type === "span_bytes_exceeded",
      ),
    );
  });
});
