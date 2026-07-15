import { describe, it, expect } from "bun:test";
import type { TraceStream } from "@checkstack/tracestream-common";
import { DEFAULT_TRACE_STREAM_CONFIG } from "@checkstack/tracestream-common";
import type {
  Storage,
  TraceStreamActivity,
  TraceWindowLatency,
} from "../storage";
import { loadStreamHandle, createStorageReader } from "./reader";

const STREAM_CREATED = new Date("2026-01-01T00:00:00.000Z");

const sampleStream: TraceStream = {
  id: "stream-1",
  name: "Traces",
  description: null,
  config: DEFAULT_TRACE_STREAM_CONFIG,
  createdAt: STREAM_CREATED,
  updatedAt: STREAM_CREATED,
};

interface PortStubs {
  stream?: TraceStream | null;
  windowCounts?: { spanCount: number; errorSpanCount: number };
  overview?: { spans: number; traces: number; errorTraces: number; retainedTraces: number };
  activity?: TraceStreamActivity | null;
  latency?: TraceWindowLatency;
  /** Captures the args each read port received. */
  spy?: {
    sumWindowCounts?: Record<string, unknown>;
    overviewTotals?: Record<string, unknown>;
    queryWindowLatency?: Record<string, unknown>;
  };
}

/**
 * Storage stub exposing only the ports the reader touches, so the READER's own
 * mapping/summing logic runs (collectors use a fake reader; this covers the
 * reader itself). Casts the partial stub to Storage.
 */
function fakeStorage(stubs: PortStubs): Storage {
  return {
    streams: {
      get: async () => stubs.stream ?? null,
    },
    opBuckets: {
      sumWindowCounts: async (args: Record<string, unknown>) => {
        if (stubs.spy) stubs.spy.sumWindowCounts = args;
        return stubs.windowCounts ?? { spanCount: 0, errorSpanCount: 0 };
      },
      queryWindowLatency: async (args: Record<string, unknown>) => {
        if (stubs.spy) stubs.spy.queryWindowLatency = args;
        return (
          stubs.latency ?? {
            spanCount: 0,
            errorCount: 0,
            durSumMs: 0,
            durMinMs: null,
            durMaxMs: null,
            p95Ms: null,
          }
        );
      },
    },
    summaries: {
      overviewTotals: async (args: Record<string, unknown>) => {
        if (stubs.spy) stubs.spy.overviewTotals = args;
        return (
          stubs.overview ?? {
            spans: 0,
            traces: 0,
            errorTraces: 0,
            retainedTraces: 0,
          }
        );
      },
    },
    activity: {
      read: async () => stubs.activity ?? null,
    },
  } as unknown as Storage;
}

describe("loadStreamHandle", () => {
  it("returns the stream identity when the row exists", async () => {
    const handle = await loadStreamHandle({
      storage: fakeStorage({ stream: sampleStream }),
      streamId: "stream-1",
    });
    expect(handle).toEqual({
      streamId: "stream-1",
      streamCreatedAt: STREAM_CREATED,
    });
  });

  it("returns null when the stream row is gone", async () => {
    const handle = await loadStreamHandle({
      storage: fakeStorage({ stream: null }),
      streamId: "gone",
    });
    expect(handle).toBeNull();
  });
});

describe("createStorageReader", () => {
  const handle = { streamId: "stream-1", streamCreatedAt: STREAM_CREATED };

  it("reads window span totals from the SQL count aggregate (minute grain)", async () => {
    const spy: NonNullable<PortStubs["spy"]> = {};
    const from = new Date("2026-01-01T12:00:00.000Z");
    const to = new Date("2026-01-01T12:05:00.000Z");
    const reader = createStorageReader({
      storage: fakeStorage({
        windowCounts: { spanCount: 120, errorSpanCount: 8 },
        spy,
      }),
      handle,
    });
    const totals = await reader.readWindowSpanTotals({ from, to });
    expect(totals).toEqual({ spanCount: 120, errorSpanCount: 8 });
    expect(spy.sumWindowCounts).toMatchObject({
      streamId: "stream-1",
      from,
      to,
      grain: "minute",
    });
  });

  it("maps overview totals to trace-level counts", async () => {
    const spy: NonNullable<PortStubs["spy"]> = {};
    const since = new Date("2026-01-01T12:00:00.000Z");
    const reader = createStorageReader({
      storage: fakeStorage({
        overview: { spans: 500, traces: 30, errorTraces: 5, retainedTraces: 12 },
        spy,
      }),
      handle,
    });
    const totals = await reader.readWindowTraceTotals({ since });
    expect(totals).toEqual({ traceCount: 30, errorTraceCount: 5 });
    expect(spy.overviewTotals).toMatchObject({ streamId: "stream-1", since });
  });

  it("reads lastReceivedAt from the activity row (null when never active)", async () => {
    const lastReceivedAt = new Date("2026-01-01T12:02:30.000Z");
    const withActivity = createStorageReader({
      storage: fakeStorage({
        activity: {
          streamId: "stream-1",
          lastReceivedAt,
          approxSpansPerMinute: 10,
          droppedSpansCount: 0,
          droppedTracesCount: 0,
          droppedInTransitCount: 0,
        },
      }),
      handle,
    });
    expect(await withActivity.readLastReceivedAt()).toEqual(lastReceivedAt);

    const noActivity = createStorageReader({
      storage: fakeStorage({ activity: null }),
      handle,
    });
    expect(await noActivity.readLastReceivedAt()).toBeNull();
  });

  it("passes the operation-latency read through to the merged window aggregate", async () => {
    const spy: NonNullable<PortStubs["spy"]> = {};
    const from = new Date("2026-01-01T12:00:00.000Z");
    const to = new Date("2026-01-01T12:05:00.000Z");
    const latency: TraceWindowLatency = {
      spanCount: 40,
      errorCount: 2,
      durSumMs: 4000,
      durMinMs: 5,
      durMaxMs: 900,
      p95Ms: 512,
    };
    const reader = createStorageReader({
      storage: fakeStorage({ latency, spy }),
      handle,
    });
    const result = await reader.readOperationLatency({
      serviceName: "checkout",
      spanName: "POST /pay",
      from,
      to,
    });
    expect(result).toEqual(latency);
    expect(spy.queryWindowLatency).toMatchObject({
      streamId: "stream-1",
      serviceName: "checkout",
      spanName: "POST /pay",
      from,
      to,
      grain: "minute",
    });
  });

  it("exposes the bound stream identity", () => {
    const reader = createStorageReader({ storage: fakeStorage({}), handle });
    expect(reader.streamId).toBe("stream-1");
    expect(reader.streamCreatedAt).toEqual(STREAM_CREATED);
  });
});
