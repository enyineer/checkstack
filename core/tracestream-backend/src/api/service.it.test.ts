import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import path from "node:path";
import {
  withTestDb,
  isIntegrationEnabled,
  createMockLogger,
  type TestDb,
} from "@checkstack/test-utils-backend";
import type { RpcClient } from "@checkstack/backend-api";
import type { TelemetrySourceLifecycle } from "@checkstack/telemetry-backend";
import { DEFAULT_TRACE_STREAM_CONFIG } from "@checkstack/tracestream-common";
import * as schema from "../schema";
import { createStorage, type Storage } from "../storage";
import type { InsertSpanInput, SummaryFlushInput } from "../storage";
import { createTracestreamService, type TracestreamService } from "./service";

const MIGRATIONS = path.join(import.meta.dir, "..", "..", "drizzle");
const STREAM = "stream-svc-it";
const OTHER = "stream-svc-it-2";
const NOW = new Date("2026-03-01T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

function span(
  over: Partial<InsertSpanInput> & {
    streamId: string;
    traceId: string;
    spanId: string;
    startTs: Date;
  },
): InsertSpanInput {
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

function flush(
  over: Partial<SummaryFlushInput> & {
    streamId: string;
    traceId: string;
    startTs: Date;
    lastSpanAt: Date;
  },
): SummaryFlushInput {
  return {
    spanCount: 1,
    errorSpanCount: 0,
    hasError: false,
    rootServiceName: "gateway",
    rootSpanName: "GET /pay",
    ...over,
  };
}

describe.skipIf(!isIntegrationEnabled())("tracestream service (integration)", () => {
  let test: TestDb<typeof schema>;
  let storage: Storage;

  beforeAll(async () => {
    test = await withTestDb({ schema, migrationsFolder: MIGRATIONS });
    storage = createStorage({ db: test.db });
  });
  afterAll(async () => {
    await test.dispose();
  });

  beforeEach(async () => {
    const { db } = test;
    for (const table of [
      schema.traceOpMinuteBuckets,
      schema.traceOpHourlyBuckets,
      schema.traceSpans,
      schema.traceSummaries,
      schema.traceServiceOps,
      schema.traceImportantEvents,
      schema.traceStreamActivity,
      schema.traceStreams,
    ]) {
      await db.delete(table);
    }
  });

  function buildService(overrides?: {
    rpcClient?: RpcClient;
    sourceLifecycle?: TelemetrySourceLifecycle;
  }): TracestreamService {
    return createTracestreamService({
      storage,
      logger: createMockLogger(),
      rpcClient: overrides?.rpcClient,
      sourceLifecycle: overrides?.sourceLifecycle,
      now: () => NOW,
    });
  }

  it("createStream defaults config, updateStream merges a partial, get/delete round-trip", async () => {
    const service = buildService();
    const created = await service.createStream({
      name: "IT stream",
      config: { serviceCap: 7 },
    });
    // The partial is defaulted through the schema: serviceCap honored, the rest
    // keep their defaults.
    expect(created.config.serviceCap).toBe(7);
    expect(created.config.hotRetentionHours).toBe(
      DEFAULT_TRACE_STREAM_CONFIG.hotRetentionHours,
    );
    expect((await service.getStream({ id: created.id })).name).toBe("IT stream");

    const updated = await service.updateStream({
      id: created.id,
      body: { name: "Renamed", config: { serviceCap: 9 } },
    });
    expect(updated.name).toBe("Renamed");
    // Merge: the new serviceCap wins, previously-defaulted fields survive.
    expect(updated.config.serviceCap).toBe(9);
    expect(updated.config.hotRetentionHours).toBe(
      DEFAULT_TRACE_STREAM_CONFIG.hotRetentionHours,
    );

    await expect(
      service.updateStream({ id: "missing", body: { name: "x" } }),
    ).rejects.toThrow(/not found/i);

    await service.deleteStream({ id: created.id });
    await expect(service.getStream({ id: created.id })).rejects.toThrow(
      /not found/i,
    );
  });

  it("deleteStream cleans grants AND cascades the deletion to bound telemetry sources", async () => {
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
    // Push tokens are platform-owned now: instead of surviving untouched, a
    // stream deletion drives the telemetry platform's source cascade. Assert the
    // lifecycle is invoked with this signal + stream id (a stub records it - the
    // IT harness cannot load telemetry's schema).
    const streamDeletes: Array<{ signal: string; streamId: string }> = [];
    const sourceLifecycle = {
      handleStreamDeleted: async (input: {
        signal: string;
        streamId: string;
      }) => {
        streamDeletes.push(input);
      },
    } as unknown as TelemetrySourceLifecycle;
    const service = buildService({ rpcClient, sourceLifecycle });
    const stream = await service.createStream({ name: "Doomed" });

    await service.deleteStream({ id: stream.id });

    expect(grantCleanup).toEqual({
      objectType: "tracestream.stream",
      objectId: stream.id,
    });
    // The platform is told to strip this stream's binding from every source and
    // delete sources left binding-less.
    expect(streamDeletes).toEqual([
      { signal: "traces", streamId: stream.id },
    ]);
    // The stream row is gone; tracestream no longer owns any token table.
    await expect(service.getStream({ id: stream.id })).rejects.toThrow(
      /not found/i,
    );
  });

  it("searchTraces pages across multiple pages via the keyset cursor", async () => {
    const service = buildService();
    const stream = await service.createStream({ name: "Search stream" });
    // Five traces at distinct, descending start times inside the window.
    const flushes: SummaryFlushInput[] = [];
    for (let i = 0; i < 5; i++) {
      flushes.push(
        flush({
          streamId: stream.id,
          traceId: `t-${i}`,
          startTs: hoursAgo(i + 1),
          lastSpanAt: hoursAgo(i + 1),
        }),
      );
    }
    await storage.summaries.upsertFromFlush({ summaries: flushes });

    const window = { from: hoursAgo(24), to: NOW };
    const seen: string[] = [];
    let cursor: { startTs: Date; traceId: string } | undefined;
    let pages = 0;
    for (;;) {
      const page = await service.searchTraces({
        streamId: stream.id,
        ...window,
        limit: 2,
        ...(cursor ? { cursor } : {}),
      });
      pages++;
      seen.push(...page.traces.map((t) => t.traceId));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
      if (pages > 10) throw new Error("paging did not terminate");
    }
    expect(pages).toBe(3); // 2 + 2 + 1
    expect(new Set(seen).size).toBe(5);
    expect(seen.toSorted()).toEqual(["t-0", "t-1", "t-2", "t-3", "t-4"]);
  });

  it("getTrace returns the summary + spans, and NOT_FOUND when absent", async () => {
    const service = buildService();
    const stream = await service.createStream({ name: "Trace stream" });
    await storage.summaries.upsertFromFlush({
      summaries: [
        flush({
          streamId: stream.id,
          traceId: "trace-1",
          startTs: hoursAgo(1),
          lastSpanAt: hoursAgo(1),
          spanCount: 2,
        }),
      ],
    });
    await storage.spans.insertSpans({
      spans: [
        span({ streamId: stream.id, traceId: "trace-1", spanId: "s1", startTs: hoursAgo(1) }),
        span({
          streamId: stream.id,
          traceId: "trace-1",
          spanId: "s2",
          parentSpanId: "s1",
          startTs: hoursAgo(1),
        }),
      ],
    });

    const result = await service.getTrace({ streamId: stream.id, traceId: "trace-1" });
    expect(result.summary.traceId).toBe("trace-1");
    expect(result.spans).toHaveLength(2);

    await expect(
      service.getTrace({ streamId: stream.id, traceId: "nope" }),
    ).rejects.toThrow(/not found/i);
  });

  it("getStreamOverview reports totals, lastReceivedAt, slowest retained and top services", async () => {
    const service = buildService();
    const stream = await service.createStream({ name: "Overview stream" });
    // Three traces: two retained (one slow, one fast), one dropped error trace.
    await storage.summaries.upsertFromFlush({
      summaries: [
        flush({
          streamId: stream.id,
          traceId: "slow",
          startTs: hoursAgo(2),
          lastSpanAt: hoursAgo(2),
          spanCount: 4,
        }),
        flush({
          streamId: stream.id,
          traceId: "fast",
          startTs: hoursAgo(3),
          lastSpanAt: hoursAgo(3),
          spanCount: 2,
        }),
        flush({
          streamId: stream.id,
          traceId: "err",
          startTs: hoursAgo(1),
          lastSpanAt: hoursAgo(1),
          spanCount: 1,
          errorSpanCount: 1,
          hasError: true,
        }),
      ],
    });
    // Give "slow" a larger duration extent than "fast" via a later last span.
    await storage.summaries.upsertFromFlush({
      summaries: [
        flush({
          streamId: stream.id,
          traceId: "slow",
          startTs: hoursAgo(2),
          lastSpanAt: new Date(hoursAgo(2).getTime() + 5_000),
          spanCount: 0,
        }),
      ],
    });
    await storage.summaries.markDecided({
      streamId: stream.id,
      traceIds: ["slow", "fast"],
      retained: true,
      decidedAt: NOW,
    });
    await storage.summaries.markDecided({
      streamId: stream.id,
      traceIds: ["err"],
      retained: false,
      decidedAt: NOW,
    });
    await storage.activity.touch({
      streamId: stream.id,
      receivedAt: hoursAgo(1),
      rateEstimate: 42,
      droppedSpans: 9,
      droppedTraces: 4,
    });
    await storage.activity.addInTransitDrops({ streamId: stream.id, dropped: 6 });
    // Seed op buckets for top-services (insert the tier rows directly).
    await test.db.insert(schema.traceOpMinuteBuckets).values([
      {
        streamId: stream.id,
        serviceName: "gateway",
        spanName: "GET /pay",
        bucketStart: hoursAgo(1),
        spanCount: 100,
        errorCount: 1,
        durSumMs: 1000,
        durMinMs: 1,
        durMaxMs: 50,
      },
      {
        streamId: stream.id,
        serviceName: "worker",
        spanName: "process",
        bucketStart: hoursAgo(1),
        spanCount: 10,
        errorCount: 0,
        durSumMs: 100,
        durMinMs: 1,
        durMaxMs: 20,
      },
    ]);

    const overview = await service.getStreamOverview({ streamId: stream.id });
    expect(overview.totals24h.traces).toBe(3);
    expect(overview.totals24h.errorTraces).toBe(1);
    expect(overview.totals24h.retainedTraces).toBe(2);
    expect(overview.totals24h.spans).toBe(7); // 4 + 2 + 1
    expect(overview.lastReceivedAt?.getTime()).toBe(hoursAgo(1).getTime());
    // Drop counters flow through from the activity row.
    expect(overview.droppedSpansCount).toBe(9);
    expect(overview.droppedTracesCount).toBe(4);
    expect(overview.droppedInTransitCount).toBe(6);
    // Only retained traces, slowest first.
    expect(overview.slowestRetained.map((t) => t.traceId)).toEqual(["slow", "fast"]);
    // Top services by span volume, descending.
    expect(overview.topServices.map((s) => s.serviceName)).toEqual([
      "gateway",
      "worker",
    ]);
    expect(overview.topServices[0]!.spanCount).toBe(100);
  });

  it("listStreamSummaries batches per-stream counts across two streams (no N+1)", async () => {
    const service = buildService();
    const a = await service.createStream({ name: "Alpha" });
    const b = await service.createStream({ name: "Bravo" });
    await storage.summaries.upsertFromFlush({
      summaries: [
        flush({ streamId: a.id, traceId: "a1", startTs: hoursAgo(1), lastSpanAt: hoursAgo(1) }),
        flush({
          streamId: a.id,
          traceId: "a2",
          startTs: hoursAgo(2),
          lastSpanAt: hoursAgo(2),
          hasError: true,
          errorSpanCount: 1,
        }),
        flush({ streamId: b.id, traceId: "b1", startTs: hoursAgo(1), lastSpanAt: hoursAgo(1) }),
      ],
    });
    await storage.serviceOps.touch({
      streamId: a.id,
      entries: [
        { serviceName: "gateway", spanName: "op1", kind: "server", seenAt: hoursAgo(1) },
        { serviceName: "worker", spanName: "op2", kind: "internal", seenAt: hoursAgo(1) },
      ],
      serviceCap: 100,
      operationCapPerService: 500,
    });
    await storage.activity.touch({
      streamId: b.id,
      receivedAt: hoursAgo(1),
      rateEstimate: 10,
    });

    const { summaries } = await service.listStreamSummaries();
    const byId = new Map(summaries.map((s) => [s.id, s]));
    expect(byId.size).toBe(2);
    expect(byId.get(a.id)).toMatchObject({
      name: "Alpha",
      traces24h: 2,
      errorTraces24h: 1,
      serviceCount: 2,
    });
    expect(byId.get(b.id)).toMatchObject({
      name: "Bravo",
      traces24h: 1,
      errorTraces24h: 0,
      serviceCount: 0,
    });
    expect(byId.get(b.id)!.lastReceivedAt?.getTime()).toBe(hoursAgo(1).getTime());
  });

  it("findTraceById returns every stream a trace id appears in, with names", async () => {
    const service = buildService();
    const a = await service.createStream({ name: "Alpha" });
    const b = await service.createStream({ name: "Bravo" });
    await storage.summaries.upsertFromFlush({
      summaries: [
        flush({ streamId: a.id, traceId: "shared", startTs: hoursAgo(1), lastSpanAt: hoursAgo(1) }),
        flush({ streamId: b.id, traceId: "shared", startTs: hoursAgo(1), lastSpanAt: hoursAgo(1) }),
      ],
    });

    const result = await service.findTraceById({ traceId: "shared" });
    expect(result.matches.map((m) => m.id).toSorted()).toEqual(
      [a.id, b.id].toSorted(),
    );
    const names = new Map(result.matches.map((m) => [m.id, m.streamName]));
    expect(names.get(a.id)).toBe("Alpha");
    expect(names.get(b.id)).toBe("Bravo");

    expect((await service.findTraceById({ traceId: "none" })).matches).toEqual([]);
  });
});
