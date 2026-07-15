import { describe, it, expect, mock } from "bun:test";
import {
  createMockLogger,
  createMockSignalService,
} from "@checkstack/test-utils-backend";
import {
  DEFAULT_TRACE_STREAM_CONFIG,
  type TraceStreamConfig,
} from "@checkstack/tracestream-common";
import type { NormalizedSpan } from "@checkstack/telemetry-common";
import type { ImportantEventRecorder } from "../events/recorder";
import type { CatalogDrops, InsertSpanInput, InsertedSpanKey, Storage } from "../storage";
import { createIngestPipeline } from "./pipeline";

/** Echo the inserted keys for a batch (the store reports the spans it wrote). */
function keysOf(args: unknown): InsertedSpanKey[] {
  const { spans } = args as { spans: InsertSpanInput[] };
  return spans.map((s) => ({ traceId: s.traceId, spanId: s.spanId }));
}

const TRACE_ID = "5b8aa5a2d2c872e8321cf37308d69df2";

function span(over: Partial<NormalizedSpan> & { spanId: string }): NormalizedSpan {
  const startTs = over.startTs ?? new Date();
  return {
    traceId: TRACE_ID,
    name: "op",
    kind: "server",
    startTs,
    endTs: over.endTs ?? new Date(startTs.getTime() + 10),
    resource: { serviceName: "svc" },
    ...over,
  };
}

function fakeStorage(drops: CatalogDrops = { droppedServices: 0, droppedOperations: 0 }) {
  const calls = {
    // The store reports the keys it actually inserted; the pipeline folds
    // aggregates over exactly that subset, so the mock echoes the input keys.
    insertSpans: mock(async (a: unknown) => keysOf(a)),
    upsertFromFlush: mock(async (_a: unknown) => {}),
    foldSpans: mock(async (_a: unknown) => {}),
    touchCatalog: mock(async (_a: unknown) => drops),
    touchActivity: mock(async (_a: unknown) => {}),
    withFlushTransaction: mock(async (_a: unknown) => {}),
  };
  const ports = {
    spans: { insertSpans: calls.insertSpans },
    summaries: { upsertFromFlush: calls.upsertFromFlush },
    opBuckets: { foldSpans: calls.foldSpans },
    serviceOps: { touch: calls.touchCatalog },
    activity: { touch: calls.touchActivity },
  };
  // withFlushTransaction hands the fn the SAME port mocks (no real txn), so the
  // per-port call assertions still hold; a port that throws propagates out.
  calls.withFlushTransaction.mockImplementation(async (fn: unknown) => {
    await (fn as (p: typeof ports) => Promise<void>)(ports);
  });
  const storage = {
    ...ports,
    activity: ports.activity,
    withFlushTransaction: calls.withFlushTransaction,
  } as unknown as Storage;
  return { storage, calls };
}

function harness({
  drops,
  now,
}: { drops?: CatalogDrops; now?: () => Date } = {}) {
  const { storage, calls } = fakeStorage(drops);
  const records: Parameters<ImportantEventRecorder["record"]>[0][] = [];
  const recorder: ImportantEventRecorder = {
    record: mock(async (input) => {
      records.push(input);
      return {} as never;
    }),
  };
  const signal = createMockSignalService();
  const pipeline = createIngestPipeline({
    storage,
    recorder,
    signalService: signal,
    logger: createMockLogger(),
    flushIntervalMs: 100_000, // never fire on the timer during the test
    ...(now ? { now } : {}),
  });
  return { pipeline, calls, records, signal, storage };
}

const CONFIG: TraceStreamConfig = DEFAULT_TRACE_STREAM_CONFIG;

describe("createIngestPipeline", () => {
  it("buffers then flushes, writing every storage port once", async () => {
    const { pipeline, calls, signal } = harness();
    const result = pipeline.ingest({
      streamId: "s1",
      config: CONFIG,
      spans: [span({ spanId: "aaaaaaaaaaaaaaa1", parentSpanId: undefined })],
    });
    expect(result.accepted).toBe(1);
    expect(calls.insertSpans).not.toHaveBeenCalled(); // not until flush

    await pipeline.flushNow();

    expect(calls.insertSpans).toHaveBeenCalledTimes(1);
    expect(calls.upsertFromFlush).toHaveBeenCalledTimes(1);
    expect(calls.foldSpans).toHaveBeenCalledTimes(1);
    expect(calls.touchCatalog).toHaveBeenCalledTimes(1);
    expect(calls.touchActivity).toHaveBeenCalledTimes(1);
    // Debounced activity signal fires once on the flush.
    expect(signal.getRecordedSignalsById("tracestream.activity")).toHaveLength(1);
    pipeline.stop();
  });

  it("rate-limits above softRateLimitPerMinute and records a rate_limited event", async () => {
    const { pipeline, records } = harness();
    const config: TraceStreamConfig = { ...CONFIG, softRateLimitPerMinute: 2 };
    const result = pipeline.ingest({
      streamId: "s1",
      config,
      spans: [
        span({ spanId: "aaaaaaaaaaaaaaa1" }),
        span({ spanId: "aaaaaaaaaaaaaaa2" }),
        span({ spanId: "aaaaaaaaaaaaaaa3" }),
        span({ spanId: "aaaaaaaaaaaaaaa4" }),
      ],
    });
    expect(result.accepted).toBe(2);
    expect(result.rejectedRateLimit).toBe(2);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    // The rate_limited event is recorded fire-and-forget from ingest.
    await new Promise((r) => setTimeout(r, 0));
    expect(records.map((e) => e.type)).toContain("rate_limited");
    pipeline.stop();
  });

  it("drops over-cap spans per trace and records span_cap_exceeded", async () => {
    const { pipeline, records, calls } = harness();
    const config: TraceStreamConfig = { ...CONFIG, maxSpansPerTrace: 2 };
    pipeline.ingest({
      streamId: "s1",
      config,
      spans: Array.from({ length: 5 }, (_, i) =>
        span({ spanId: `aaaaaaaaaaaaaa${i}0` }),
      ),
    });
    await pipeline.flushNow();
    expect(records.map((e) => e.type)).toContain("span_cap_exceeded");
    // Activity touch carries the drop count.
    const activityArg = calls.touchActivity.mock.calls[0]![0] as { droppedSpans: number };
    expect(activityArg.droppedSpans).toBe(3);
    pipeline.stop();
  });

  it("records service_cap_exceeded and operation_cap_exceeded from catalog drops", async () => {
    const { pipeline, records } = harness({
      drops: { droppedServices: 1, droppedOperations: 2 },
    });
    pipeline.ingest({
      streamId: "s1",
      config: CONFIG,
      spans: [span({ spanId: "aaaaaaaaaaaaaaa1" })],
    });
    await pipeline.flushNow();
    const types = records.map((e) => e.type);
    expect(types).toContain("service_cap_exceeded");
    expect(types).toContain("operation_cap_exceeded");
    pipeline.stop();
  });

  it("drops a flush batch on a write error without throwing", async () => {
    const { storage } = fakeStorage();
    (storage.spans.insertSpans as ReturnType<typeof mock>).mockImplementation(
      async () => {
        throw new Error("db down");
      },
    );
    const recorder: ImportantEventRecorder = { record: mock(async () => ({}) as never) };
    const pipeline = createIngestPipeline({
      storage,
      recorder,
      signalService: createMockSignalService(),
      logger: createMockLogger(),
      flushIntervalMs: 100_000,
    });
    pipeline.ingest({
      streamId: "s1",
      config: CONFIG,
      spans: [span({ spanId: "aaaaaaaaaaaaaaa1" })],
    });
    await expect(pipeline.flushNow()).resolves.toBeUndefined();
    pipeline.stop();
  });

  it("retries a failed flush exactly once, then commits without double-folding", async () => {
    const { pipeline, calls } = harness();
    let attempts = 0;
    calls.insertSpans.mockImplementation(async (a: unknown) => {
      attempts += 1;
      if (attempts === 1) throw new Error("transient"); // first attempt rolls back
      return keysOf(a);
    });
    pipeline.ingest({
      streamId: "s1",
      config: CONFIG,
      spans: [span({ spanId: "aaaaaaaaaaaaaaa1" })],
    });
    await pipeline.flushNow();
    // Two transaction attempts; the second one committed.
    expect(calls.withFlushTransaction).toHaveBeenCalledTimes(2);
    expect(calls.insertSpans).toHaveBeenCalledTimes(2);
    // The first attempt threw before foldSpans, so the additive fold ran ONCE.
    expect(calls.foldSpans).toHaveBeenCalledTimes(1);
    pipeline.stop();
  });

  it("records span_bytes_exceeded when a span's payloads exceed maxSpanBytes", async () => {
    const { pipeline, records } = harness();
    const config: TraceStreamConfig = { ...CONFIG, maxSpanBytes: 256 };
    pipeline.ingest({
      streamId: "s1",
      config,
      spans: [span({ spanId: "aaaaaaaaaaaaaaa1", attributes: { big: "x".repeat(2000) } })],
    });
    // The byte-cap event is recorded fire-and-forget from ingest.
    await new Promise((r) => setTimeout(r, 0));
    expect(records.map((e) => e.type)).toContain("span_bytes_exceeded");
    pipeline.stop();
  });
});
