import { describe, it, expect, mock } from "bun:test";
import type {
  SafeDatabase,
  Logger,
  RpcClient,
} from "@checkstack/backend-api";
import type { TelemetrySourceLifecycle } from "@checkstack/telemetry-backend";
import {
  DEFAULT_LOG_STREAM_CONFIG,
  logstreamResourceTypes,
} from "@checkstack/logstream-common";
import {
  createLogstreamService,
  escapeLikePattern,
  nextCursorFor,
  assembleStreamSummaries,
} from "./service";
import type { Storage } from "../storage";
import * as schema from "../schema";
import {
  logStreams,
  logEvents,
  logSeverityBuckets,
  logPatternBuckets,
  logSeverityHourly,
  logPatternHourly,
  logPatterns,
  logImportantEvents,
  logStreamActivity,
  logStreamSystemLinks,
} from "../schema";

// =============================================================================
// Test doubles
// =============================================================================

/** A chainable, awaitable stand-in for a drizzle query builder. */
interface Chain<T> extends PromiseLike<T[]> {
  from: () => Chain<T>;
  where: () => Chain<T>;
  orderBy: () => Chain<T>;
  limit: () => Chain<T>;
  groupBy: () => Chain<T>;
}

function chain<T>(rows: T[]): Chain<T> {
  const c: Chain<T> = {
    from: () => c,
    where: () => c,
    orderBy: () => c,
    limit: () => c,
    groupBy: () => c,
    then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
  };
  return c;
}

function mockLogger(): Logger {
  return {
    info: mock(),
    error: mock(),
    warn: mock(),
    debug: mock(),
    child: mock(() => mockLogger()),
  };
}

const noopStorage = {} as unknown as Storage;

const asDb = (fake: unknown) => fake as unknown as SafeDatabase<typeof schema>;

/** An rpcClient whose auth `deleteObjectRelations` records its input. */
function recordingRpcClient(): {
  rpcClient: RpcClient;
  relationDeletes: Array<{ objectType: string; objectId: string }>;
} {
  const relationDeletes: Array<{ objectType: string; objectId: string }> = [];
  const rpcClient = {
    forPlugin: () => ({
      deleteObjectRelations: async (input: {
        objectType: string;
        objectId: string;
      }) => {
        relationDeletes.push(input);
      },
    }),
  } as unknown as RpcClient;
  return { rpcClient, relationDeletes };
}

/** A telemetry source lifecycle that records `handleStreamDeleted` inputs. */
function recordingSourceLifecycle(): {
  sourceLifecycle: TelemetrySourceLifecycle;
  streamDeletes: Array<{ signal: string; streamId: string }>;
} {
  const streamDeletes: Array<{ signal: string; streamId: string }> = [];
  const sourceLifecycle = {
    handleStreamDeleted: async (input: { signal: string; streamId: string }) => {
      streamDeletes.push(input);
    },
  } as unknown as TelemetrySourceLifecycle;
  return { sourceLifecycle, streamDeletes };
}

// =============================================================================
// Pure helpers
// =============================================================================

describe("escapeLikePattern", () => {
  it("escapes LIKE metacharacters so the term matches literally", () => {
    expect(escapeLikePattern("100%_done")).toBe("100\\%\\_done");
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
    expect(escapeLikePattern("plain text")).toBe("plain text");
  });
});

describe("nextCursorFor", () => {
  const evt = (id: string, ts: string) =>
    ({ id, ts: new Date(ts) }) as never;

  it("returns null when the page was not full (end of results)", () => {
    expect(nextCursorFor([evt("1", "2026-01-01T00:00:00Z")], 100)).toBeNull();
  });

  it("returns the last row's (ts, id) when the page was full", () => {
    const events = [
      evt("9", "2026-01-01T00:02:00Z"),
      evt("8", "2026-01-01T00:01:00Z"),
    ];
    expect(nextCursorFor(events, 2)).toEqual({
      ts: new Date("2026-01-01T00:01:00Z"),
      id: "8",
    });
  });
});

describe("assembleStreamSummaries", () => {
  it("sums error/warn across the minute+hourly tiers and zero-fills gaps", () => {
    const lastReceived = new Date("2026-01-02T00:00:00Z");
    const summaries = assembleStreamSummaries({
      streamIds: ["s1", "s2", "s3"],
      activity: [{ streamId: "s1", lastReceivedAt: lastReceived }],
      severity: [
        // s1 minute tier
        { streamId: "s1", band: "error", total: "4" },
        { streamId: "s1", band: "warn", total: "2" },
        // s1 hourly tier (older part of the 24h window) - ADDS to the minute sum
        { streamId: "s1", band: "error", total: "6" },
        // s2 only warns, only in the hourly tier
        { streamId: "s2", band: "warn", total: 5 },
      ],
      patternCounts: [
        { streamId: "s1", count: "12" },
        { streamId: "s2", count: 3 },
      ],
    });

    expect(summaries).toEqual([
      {
        id: "s1",
        lastReceivedAt: lastReceived,
        last24hErrorCount: 10, // 4 (minute) + 6 (hourly)
        last24hWarnCount: 2,
        patternCount: 12,
      },
      {
        id: "s2",
        lastReceivedAt: null,
        last24hErrorCount: 0,
        last24hWarnCount: 5,
        patternCount: 3,
      },
      // s3 has no activity/severity/patterns → all zero, still present.
      {
        id: "s3",
        lastReceivedAt: null,
        last24hErrorCount: 0,
        last24hWarnCount: 0,
        patternCount: 0,
      },
    ]);
  });
});

// =============================================================================
// Stream update config merge
// =============================================================================

describe("updateStream", () => {
  it("merges a partial config into the existing config", async () => {
    const existing = {
      id: "stream-1",
      name: "orig",
      description: "d",
      config: { ...DEFAULT_LOG_STREAM_CONFIG, infoSampleRate: 0.5 },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    let setValues: Record<string, unknown> | undefined;
    const fakeDb = {
      select: () => ({ from: () => chain([existing]) }),
      update: () => ({
        set: (v: Record<string, unknown>) => {
          setValues = v;
          return {
            where: () => ({
              returning: async () => [{ ...existing, ...v }],
            }),
          };
        },
      }),
    };
    const service = createLogstreamService({
      db: asDb(fakeDb),
      storage: noopStorage,
      logger: mockLogger(),
    });

    const result = await service.updateStream({
      id: "stream-1",
      body: { config: { maxRawPerMinute: 42 } },
    });

    // The unspecified knob (infoSampleRate) is preserved; the new one applied.
    const merged = setValues?.config as { infoSampleRate: number; maxRawPerMinute: number };
    expect(merged.infoSampleRate).toBe(0.5);
    expect(merged.maxRawPerMinute).toBe(42);
    expect(result.config.maxRawPerMinute).toBe(42);
  });
});

// =============================================================================
// Delete cascade
// =============================================================================

describe("deleteStream", () => {
  it("cascades deletes across every stream-scoped table (sources are platform-owned)", async () => {
    const deletedTables: unknown[] = [];
    const tx = {
      select: () => ({
        from: (table: unknown) => {
          if (table === logEvents) {
            // One non-empty batch, then the loop ends (batch < BATCH size).
            return chain([{ eventId: 1 }]);
          }
          return chain([]);
        },
      }),
      delete: (table: unknown) => ({
        where: async () => {
          deletedTables.push(table);
        },
      }),
    };
    const fakeDb = {
      transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };
    const service = createLogstreamService({
      db: asDb(fakeDb),
      storage: noopStorage,
      logger: mockLogger(),
    });

    await service.deleteStream({ id: "stream-1" });

    // Every stream-scoped child table AND the stream row are deleted. The push
    // SOURCES bound to the stream are NOT touched - the telemetry platform owns
    // their lifecycle, and the `log_stream_tokens` table no longer exists.
    expect(new Set(deletedTables)).toEqual(
      new Set([
        logEvents,
        logSeverityBuckets,
        logPatternBuckets,
        logSeverityHourly,
        logPatternHourly,
        logPatterns,
        logImportantEvents,
        logStreamActivity,
        logStreamSystemLinks,
        logStreams,
      ]),
    );
  });

  it("deletes the stream's team grants via auth after the cascade", async () => {
    const tx = {
      select: () => ({ from: () => chain([]) }),
      delete: () => ({ where: async () => {} }),
    };
    const fakeDb = {
      transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };
    const { rpcClient, relationDeletes } = recordingRpcClient();
    const service = createLogstreamService({
      db: asDb(fakeDb),
      storage: noopStorage,
      logger: mockLogger(),
      rpcClient,
    });

    await service.deleteStream({ id: "stream-1" });

    // The stream's ReBAC grants are cleared under the SAME qualified type the
    // access rule keys grants on (logstream.stream), for this stream id.
    expect(relationDeletes).toEqual([
      { objectType: logstreamResourceTypes.stream, objectId: "stream-1" },
    ]);
  });

  it("still deletes the stream when no rpcClient is wired (grant cleanup skipped)", async () => {
    const tx = {
      select: () => ({ from: () => chain([]) }),
      delete: () => ({ where: async () => {} }),
    };
    const fakeDb = {
      transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };
    const logger = mockLogger();
    const service = createLogstreamService({
      db: asDb(fakeDb),
      storage: noopStorage,
      logger,
    });

    // No rpcClient: the delete succeeds and the missing-client case is warned.
    await service.deleteStream({ id: "stream-1" });
    expect(logger.warn).toHaveBeenCalled();
  });

  it("cascades the deletion to bound telemetry sources with the logs signal", async () => {
    const tx = {
      select: () => ({ from: () => chain([]) }),
      delete: () => ({ where: async () => {} }),
    };
    const fakeDb = {
      transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };
    const { sourceLifecycle, streamDeletes } = recordingSourceLifecycle();
    const service = createLogstreamService({
      db: asDb(fakeDb),
      storage: noopStorage,
      logger: mockLogger(),
      sourceLifecycle,
    });

    await service.deleteStream({ id: "stream-1" });

    // The platform is told to strip this stream's binding from every source.
    expect(streamDeletes).toEqual([{ signal: "logs", streamId: "stream-1" }]);
  });

  it("still deletes the stream when the source cascade throws (warns, does not rethrow)", async () => {
    const tx = {
      select: () => ({ from: () => chain([]) }),
      delete: () => ({ where: async () => {} }),
    };
    const fakeDb = {
      transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };
    const logger = mockLogger();
    const sourceLifecycle = {
      handleStreamDeleted: async () => {
        throw new Error("platform unavailable");
      },
    } as unknown as TelemetrySourceLifecycle;
    const service = createLogstreamService({
      db: asDb(fakeDb),
      storage: noopStorage,
      logger,
      sourceLifecycle,
    });

    // The stream deletion already succeeded, so a failing cascade is logged.
    await service.deleteStream({ id: "stream-1" });
    expect(logger.warn).toHaveBeenCalled();
  });
});

// =============================================================================
// Search mapping + pagination
// =============================================================================

describe("searchEvents", () => {
  it("maps rows (bigint id → string) and returns a cursor when the page is full", async () => {
    const rows = [
      {
        id: 20,
        streamId: "stream-1",
        ts: new Date("2026-01-01T00:02:00Z"),
        observedAt: new Date("2026-01-01T00:02:00Z"),
        severityNumber: 18,
        severityText: "ERROR",
        band: "error" as const,
        body: "boom",
        attributes: null,
        resource: null,
        patternId: "p1",
        traceId: null,
        spanId: null,
      },
      {
        id: 19,
        streamId: "stream-1",
        ts: new Date("2026-01-01T00:01:00Z"),
        observedAt: new Date("2026-01-01T00:01:00Z"),
        severityNumber: 9,
        severityText: null,
        band: "info" as const,
        body: "hello",
        attributes: null,
        resource: null,
        patternId: null,
        traceId: null,
        spanId: null,
      },
    ];
    const fakeDb = {
      select: () => ({ from: () => chain(rows) }),
    };
    const service = createLogstreamService({
      db: asDb(fakeDb),
      storage: noopStorage,
      logger: mockLogger(),
    });

    const result = await service.searchEvents({ streamId: "stream-1", limit: 2 });

    expect(result.events.map((e) => e.id)).toEqual(["20", "19"]);
    expect(result.events[0]!.band).toBe("error");
    // Full page (2 rows, limit 2) → a cursor to the last row is returned.
    expect(result.nextCursor).toEqual({
      ts: new Date("2026-01-01T00:01:00Z"),
      id: "19",
    });
  });
});

