import { describe, it, expect, mock } from "bun:test";
import { SQL } from "drizzle-orm";
import {
  createMockLogger,
  createMockSignalService,
} from "@checkstack/test-utils-backend";
import {
  DEFAULT_LOG_STREAM_CONFIG,
  SEVERITY_NUMBER_FOR_BAND,
  type IngestedLine,
  type SeverityBand,
} from "@checkstack/logstream-common";
import type { SafeDatabase } from "@checkstack/backend-api";
import type * as schema from "../schema";
import type { Storage, PatternUpsert } from "../storage";
import type { DrainEngine } from "../drain/engine";
import type { ImportantEventRecorder } from "../events/recorder";
import { IngestCountersRegistry } from "./counters";
import { createIngestPipeline } from "./pipeline";
import {
  createInProcessFlushExecutor,
  type FlushExecutor,
} from "./flush-executor";

function line(band: SeverityBand, body: string): IngestedLine {
  return {
    ts: new Date(100 * 60_000),
    observedAt: new Date(100 * 60_000),
    severityNumber: SEVERITY_NUMBER_FOR_BAND[band],
    band,
    body,
  };
}

function mockDrain(): DrainEngine {
  const pending: PatternUpsert[] = [];
  return {
    classify: ({ body }) => ({
      patternId: `p:${body.replace(/\d+/g, "<*>")}`,
      isNew: false,
      template: body,
      tokenCount: 1,
      severityNumber: 9,
      wildcardValues: [],
    }),
    pendingPatternUpserts: () => pending.splice(0),
    hydrateStream: async () => {},
    upsertUserPattern: ({ template }) => ({ patternId: `p:${template}` }),
    removeUserPattern: () => {},
    setProtectedPatterns: () => {},
  };
}

function mockStorage(): Storage {
  return {
    upsertPatterns: mock(async () => {}),
    upsertSeverityBuckets: mock(async () => {}),
    upsertPatternBuckets: mock(async () => {}),
    upsertVariableBuckets: mock(async () => {}),
    insertLogEventsBatch: mock(async () => {}),
    touchStreamActivity: mock(async () => {}),
    sumSeverityBands: mock(async () => ({
      trace: 0, debug: 0, info: 0, warn: 0, error: 0, fatal: 0,
    })),
  } as unknown as Storage;
}

/** A db whose `.transaction(fn)` fails its first `failTimes` calls, then runs fn. */
function mockDb(failTimes = 0): SafeDatabase<typeof schema> {
  let calls = 0;
  const tx = { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) }) };
  return {
    transaction: async <R>(fn: (t: unknown) => Promise<R>) => {
      calls += 1;
      if (calls <= failTimes) throw new Error("tx failed");
      return fn(tx);
    },
  } as unknown as SafeDatabase<typeof schema>;
}

function harness({ db = mockDb(), retryBackoffMs = 0, drain = mockDrain(), ...opts }: {
  db?: SafeDatabase<typeof schema>;
  retryBackoffMs?: number;
  drain?: DrainEngine;
  executor?: FlushExecutor;
  bufferCap?: number;
  flushSizeThreshold?: number;
  flushIntervalMs?: number;
  now?: () => Date;
  getReferencedPatternIds?: (streamId: string) => Promise<readonly string[]>;
} = {}) {
  const storage = mockStorage();
  const signal = createMockSignalService();
  const counters = new IngestCountersRegistry();
  const onIngestFlush = mock(async () => {});
  const recorder: ImportantEventRecorder = { record: mock(async () => ({}) as never) };
  const pipeline = createIngestPipeline({
    db,
    storage,
    drain,
    recorder,
    signalService: signal,
    logger: createMockLogger(),
    onIngestFlush,
    counters,
    retryBackoffMs,
    ...opts,
  });
  return { pipeline, storage, signal, counters, onIngestFlush, recorder, drain };
}

describe("createIngestPipeline", () => {
  it("flushes buffered lines and fires the post-commit effects", async () => {
    const { pipeline, storage, signal, onIngestFlush } = harness();
    pipeline.ingest({
      streamId: "s1",
      lines: [line("info", "a"), line("error", "boom 1")],
      config: DEFAULT_LOG_STREAM_CONFIG,
    });
    await pipeline.flushNow();

    expect(storage.insertLogEventsBatch).toHaveBeenCalledTimes(1);
    expect(onIngestFlush).toHaveBeenCalledTimes(1);
    const call = (onIngestFlush as ReturnType<typeof mock>).mock.calls[0]![0];
    expect(call).toMatchObject({ streamId: "s1", worstBand: "error", errorDelta: 1 });
    // Debounced activity signal broadcast once.
    expect(signal.getRecordedSignals()).toHaveLength(1);
    expect(signal.getRecordedSignals()[0]!.payload).toMatchObject({ streamId: "s1" });
  });

  it("auto-flushes when the buffer reaches the size threshold", async () => {
    const { pipeline, storage } = harness({ flushSizeThreshold: 3 });
    pipeline.ingest({
      streamId: "s1",
      lines: [line("info", "a"), line("info", "b"), line("info", "c")],
      config: DEFAULT_LOG_STREAM_CONFIG,
    });
    // The size trigger started a flush; await the in-flight cycle.
    await pipeline.flushNow();
    expect(storage.insertLogEventsBatch).toHaveBeenCalledTimes(1);
  });

  it("flushes on the periodic timer", async () => {
    // A large size threshold so ONLY the timer can trigger the flush.
    const { pipeline, storage } = harness({
      flushSizeThreshold: 1_000_000,
      flushIntervalMs: 5,
    });
    pipeline.ingest({ streamId: "s1", lines: [line("info", "x")], config: DEFAULT_LOG_STREAM_CONFIG });
    pipeline.start();
    await new Promise((r) => setTimeout(r, 40));
    pipeline.stop();
    expect(storage.insertLogEventsBatch).toHaveBeenCalled();
  });

  it("rejects overflow with 429-worthy counts when the buffer saturates", async () => {
    const { pipeline } = harness({ bufferCap: 2 });
    const result = pipeline.ingest({
      streamId: "s1",
      lines: [line("info", "a"), line("info", "b"), line("info", "c"), line("info", "d")],
      config: DEFAULT_LOG_STREAM_CONFIG,
    });
    expect(result.accepted).toBe(2);
    expect(result.rejectedBuffer).toBe(2);
  });

  it("retries a failed flush once before succeeding", async () => {
    const { pipeline, storage, counters } = harness({ db: mockDb(1) });
    pipeline.ingest({ streamId: "s1", lines: [line("info", "a")], config: DEFAULT_LOG_STREAM_CONFIG });
    await pipeline.flushNow();
    expect(storage.insertLogEventsBatch).toHaveBeenCalledTimes(1);
    expect(counters.get("s1").linesDropped).toBe(0);
  });

  it("drops the batch after two failures without throwing", async () => {
    const { pipeline, counters, onIngestFlush } = harness({ db: mockDb(5) });
    pipeline.ingest({ streamId: "s1", lines: [line("info", "a")], config: DEFAULT_LOG_STREAM_CONFIG });
    await pipeline.flushNow();
    expect(counters.get("s1").linesDropped).toBe(1);
    expect(onIngestFlush).not.toHaveBeenCalled();
  });

  it("advances token lastUsedAt with greatest() (monotonic), not a blind Date set", async () => {
    const captured: Record<string, unknown>[] = [];
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({ orderBy: () => ({ limit: async () => [] }) }),
        }),
      }),
      update: () => ({
        set: (payload: Record<string, unknown>) => {
          captured.push(payload);
          return { where: async () => {} };
        },
      }),
    };
    const db = {
      transaction: async <R>(fn: (t: unknown) => Promise<R>) => fn(tx),
    } as unknown as SafeDatabase<typeof schema>;
    const { pipeline } = harness({ db });
    pipeline.ingest({
      streamId: "s1",
      lines: [line("info", "a")],
      config: DEFAULT_LOG_STREAM_CONFIG,
      tokenId: "tok-1",
    });
    await pipeline.flushNow();
    expect(captured).toHaveLength(1);
    // A greatest(...) expression is a drizzle SQL object, NOT a raw Date - this
    // is what keeps lastUsedAt monotonic under clock skew.
    expect(captured[0]!.lastUsedAt).toBeInstanceOf(SQL);
  });

  it("a final flush before stop persists buffered lines (graceful drain)", async () => {
    // The teardown returned by registerIngestEndpoints does exactly this: one
    // last flushNow() so buffered lines survive, then stop() to end the timer.
    const { pipeline, storage } = harness({
      flushSizeThreshold: 1_000_000,
      flushIntervalMs: 1000,
    });
    pipeline.start();
    pipeline.ingest({
      streamId: "s1",
      lines: [line("info", "pending")],
      config: DEFAULT_LOG_STREAM_CONFIG,
    });
    await pipeline.flushNow();
    pipeline.stop();
    expect(storage.insertLogEventsBatch).toHaveBeenCalledTimes(1);
  });
});

describe("createIngestPipeline - protected pattern refresh", () => {
  function recordingDrain(): {
    drain: DrainEngine;
    protectedCalls: Array<{ streamId: string; patternIds: readonly string[] }>;
  } {
    const protectedCalls: Array<{ streamId: string; patternIds: readonly string[] }> = [];
    const drain: DrainEngine = {
      ...mockDrain(),
      setProtectedPatterns: (input) => {
        protectedCalls.push({ streamId: input.streamId, patternIds: input.patternIds });
      },
    };
    return { drain, protectedCalls };
  }

  function ingestOne(pipeline: ReturnType<typeof harness>["pipeline"], body: string): void {
    pipeline.ingest({ streamId: "s1", lines: [line("info", body)], config: DEFAULT_LOG_STREAM_CONFIG });
  }

  it("resolves+pushes the referenced set on first flush, then throttles to 60s and skips unchanged sets", async () => {
    const { drain, protectedCalls } = recordingDrain();
    let clock = 1_000_000;
    const getReferencedPatternIds = mock(async () => ["p:b", "p:a"]);
    const { pipeline } = harness({
      drain,
      getReferencedPatternIds,
      now: () => new Date(clock),
    });

    // First flush: resolve + push the (sorted, deduped) set.
    ingestOne(pipeline, "a");
    await pipeline.flushNow();
    expect(getReferencedPatternIds).toHaveBeenCalledTimes(1);
    expect(protectedCalls).toEqual([{ streamId: "s1", patternIds: ["p:a", "p:b"] }]);

    // Within 60s: no re-resolve at all.
    clock += 30_000;
    ingestOne(pipeline, "b");
    await pipeline.flushNow();
    expect(getReferencedPatternIds).toHaveBeenCalledTimes(1);

    // After 60s: re-resolve, but an unchanged set skips the drain push.
    clock += 61_000;
    ingestOne(pipeline, "c");
    await pipeline.flushNow();
    expect(getReferencedPatternIds).toHaveBeenCalledTimes(2);
    expect(protectedCalls).toHaveLength(1);
  });

  it("pushes again once the referenced set actually changes", async () => {
    const { drain, protectedCalls } = recordingDrain();
    let clock = 1_000_000;
    let ids: string[] = ["p:a"];
    const { pipeline } = harness({
      drain,
      getReferencedPatternIds: async () => ids,
      now: () => new Date(clock),
    });

    ingestOne(pipeline, "a");
    await pipeline.flushNow();
    expect(protectedCalls).toEqual([{ streamId: "s1", patternIds: ["p:a"] }]);

    ids = ["p:a", "p:c"];
    clock += 61_000;
    ingestOne(pipeline, "b");
    await pipeline.flushNow();
    expect(protectedCalls).toEqual([
      { streamId: "s1", patternIds: ["p:a"] },
      { streamId: "s1", patternIds: ["p:a", "p:c"] },
    ]);
  });

  /**
   * Wrap an in-process executor with a mutable protection epoch and a recorder
   * for setProtectedPatterns, so a test can simulate a worker respawn / dead
   * fallback (an epoch bump) and observe the pipeline's re-push decision.
   */
  function epochExecutor(drain: DrainEngine): {
    executor: FlushExecutor;
    protectedCalls: Array<{ streamId: string; patternIds: readonly string[] }>;
    setEpoch: (n: number) => void;
  } {
    const inner = createInProcessFlushExecutor({ drain, logger: createMockLogger() });
    const protectedCalls: Array<{ streamId: string; patternIds: readonly string[] }> = [];
    let epoch = 0;
    const executor: FlushExecutor = {
      prepare: inner.prepare,
      upsertUserPattern: inner.upsertUserPattern,
      removeUserPattern: inner.removeUserPattern,
      setProtectedPatterns: (input) => {
        protectedCalls.push({ streamId: input.streamId, patternIds: input.patternIds });
      },
      protectionEpoch: () => epoch,
      stop: inner.stop,
    };
    return { executor, protectedCalls, setEpoch: (n) => { epoch = n; } };
  }

  it("re-pushes the unchanged referenced set after an executor reset (worker respawn / dead fallback)", async () => {
    const drain = mockDrain();
    const { executor, protectedCalls, setEpoch } = epochExecutor(drain);
    let clock = 1_000_000;
    const getReferencedPatternIds = mock(async () => ["p:a", "p:b"]);
    const { pipeline } = harness({
      drain,
      executor,
      getReferencedPatternIds,
      now: () => new Date(clock),
    });

    // First flush: resolve + push at epoch 0.
    ingestOne(pipeline, "a");
    await pipeline.flushNow();
    expect(getReferencedPatternIds).toHaveBeenCalledTimes(1);
    expect(protectedCalls).toEqual([{ streamId: "s1", patternIds: ["p:a", "p:b"] }]);

    // A worker respawn (or dead->fallback handover) advances the epoch. Even
    // WITHIN the 60s resolver throttle, the next flush must re-push the SAME set
    // to the fresh, empty tree without re-resolving.
    setEpoch(1);
    clock += 30_000; // still inside the resolver throttle window
    ingestOne(pipeline, "b");
    await pipeline.flushNow();
    expect(getReferencedPatternIds).toHaveBeenCalledTimes(1); // not re-resolved
    expect(protectedCalls).toEqual([
      { streamId: "s1", patternIds: ["p:a", "p:b"] },
      { streamId: "s1", patternIds: ["p:a", "p:b"] },
    ]);

    // A later flush at the SAME epoch does not re-push (idempotent).
    clock += 1_000;
    ingestOne(pipeline, "c");
    await pipeline.flushNow();
    expect(protectedCalls).toHaveLength(2);
  });

  it("never breaks the flush when the resolver throws", async () => {
    const { drain, protectedCalls } = recordingDrain();
    const { pipeline, storage } = harness({
      drain,
      getReferencedPatternIds: async () => {
        throw new Error("resolver down");
      },
    });
    ingestOne(pipeline, "a");
    await pipeline.flushNow();
    // The flush still committed; protection was simply not applied this cycle.
    expect(storage.insertLogEventsBatch).toHaveBeenCalledTimes(1);
    expect(protectedCalls).toEqual([]);
  });

  it("is a no-op without a resolver (protection relies on origin='user')", async () => {
    const { drain, protectedCalls } = recordingDrain();
    const { pipeline, storage } = harness({ drain });
    ingestOne(pipeline, "a");
    await pipeline.flushNow();
    expect(storage.insertLogEventsBatch).toHaveBeenCalledTimes(1);
    expect(protectedCalls).toEqual([]);
  });
});
