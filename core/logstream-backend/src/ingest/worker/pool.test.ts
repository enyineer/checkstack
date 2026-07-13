import { describe, it, expect, mock } from "bun:test";
import { createMockLogger } from "@checkstack/test-utils-backend";
import type { SeverityBand } from "@checkstack/logstream-common";
import type { FlushExecutor } from "../flush-executor";
import type { FlushPlan } from "../flush";
import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
} from "./protocol";
import {
  createWorkerFlushExecutor,
  hashStreamId,
  type WorkerTransport,
} from "./pool";

/** A deterministic in-memory transport standing in for a real Bun worker. */
interface FakeTransport {
  transport: WorkerTransport;
  posted: MainToWorkerMessage[];
  /** Deliver a worker->main message. */
  emit: (message: WorkerToMainMessage) => void;
  /** Fire the transport error handler (simulate a crash). */
  crash: (error: Error) => void;
  terminated: () => boolean;
}

function fakeTransport(): FakeTransport {
  let onMessage: ((m: WorkerToMainMessage) => void) | null = null;
  let onError: ((e: Error) => void) | null = null;
  const posted: MainToWorkerMessage[] = [];
  let terminated = false;
  return {
    transport: {
      post: (m) => posted.push(m),
      onMessage: (h) => {
        onMessage = h;
      },
      onError: (h) => {
        onError = h;
      },
      terminate: () => {
        terminated = true;
      },
    },
    posted,
    emit: (m) => onMessage?.(m),
    crash: (e) => onError?.(e),
    terminated: () => terminated,
  };
}

function makePlan(streamId: string): FlushPlan {
  return {
    streamId,
    patternUpserts: [],
    severityDeltas: [],
    patternDeltas: [],
    variableDeltas: [],
    eventRows: [],
    droppedByCap: 0,
    worstBand: "info" as SeverityBand,
    errorDelta: 0,
    linesClassified: 0,
    newPatternEvents: [],
    affectedErrorMinutes: [],
    receivedAt: new Date(0),
    rateEstimate: 0,
  };
}

function recordingFallback(): FlushExecutor & {
  calls: { prepare: number; upsert: number; remove: number; protected: number; stop: number };
} {
  const calls = { prepare: 0, upsert: 0, remove: 0, protected: 0, stop: 0 };
  return {
    calls,
    prepare: async ({ streamId }) => {
      calls.prepare += 1;
      return makePlan(streamId);
    },
    upsertUserPattern: () => {
      calls.upsert += 1;
    },
    removeUserPattern: () => {
      calls.remove += 1;
    },
    setProtectedPatterns: () => {
      calls.protected += 1;
    },
    protectionEpoch: () => 0,
    stop: async () => {
      calls.stop += 1;
    },
  };
}

/** Build a pool over N fake transports and expose them in spawn order. */
function harness({
  poolSize,
  loadPatternRows = async () => [],
}: {
  poolSize: number;
  loadPatternRows?: (input: { streamId: string }) => Promise<
    { id: string; template: string; origin: string }[]
  >;
}) {
  const fakes: FakeTransport[] = [];
  const spawn = () => {
    const fake = fakeTransport();
    fakes.push(fake);
    return fake.transport;
  };
  const fallback = recordingFallback();
  const executor = createWorkerFlushExecutor({
    poolSize,
    loadPatternRows,
    fallback,
    logger: createMockLogger(),
    spawn,
  });
  return { executor, fakes, fallback };
}

const FLUSH_ARGS = {
  lines: [],
  config: {} as never,
  now: new Date(1000),
  flushIntervalMs: 500,
};

describe("createWorkerFlushExecutor", () => {
  it("spawns poolSize workers up front", () => {
    const { fakes } = harness({ poolSize: 3 });
    expect(fakes).toHaveLength(3);
  });

  it("shards a stream to a single worker by hash and resolves its flush", async () => {
    const { executor, fakes } = harness({ poolSize: 2 });
    const streamId = "stream-A";
    const slot = hashStreamId(streamId) % 2;

    const pending = executor.prepare({ ...FLUSH_ARGS, streamId });

    const posted = fakes[slot]!.posted;
    expect(posted).toHaveLength(1);
    const msg = posted[0]!;
    expect(msg.type).toBe("flush");
    if (msg.type !== "flush") throw new Error("unreachable");
    expect(msg.streamId).toBe(streamId);
    // The other worker got nothing.
    expect(fakes[1 - slot]!.posted).toHaveLength(0);

    fakes[slot]!.emit({ type: "flush-result", requestId: msg.requestId, plan: makePlan(streamId) });
    await expect(pending).resolves.toMatchObject({ streamId });
  });

  it("routes a worker hydrate-request through the main-thread loader", async () => {
    const rows = [{ id: "p1", template: "user <*> in", origin: "user" }];
    const loadPatternRows = mock(async () => rows);
    const { executor, fakes } = harness({ poolSize: 1, loadPatternRows });
    // touch the executor so it is not tree-shaken; the pool is already live
    void executor;

    fakes[0]!.emit({ type: "hydrate-request", requestId: 7, streamId: "stream-A" });
    await Promise.resolve();
    await Promise.resolve();

    expect(loadPatternRows).toHaveBeenCalledWith({ streamId: "stream-A" });
    const response = fakes[0]!.posted.find((m) => m.type === "hydrate-response");
    expect(response).toEqual({ type: "hydrate-response", requestId: 7, rows });
  });

  it("answers a failed hydration with hydrate-error (worker proceeds unseeded)", async () => {
    const loadPatternRows = mock(async () => {
      throw new Error("db down");
    });
    const { fakes } = harness({ poolSize: 1, loadPatternRows });

    fakes[0]!.emit({ type: "hydrate-request", requestId: 3, streamId: "stream-A" });
    await Promise.resolve();
    await Promise.resolve();

    const err = fakes[0]!.posted.find((m) => m.type === "hydrate-error");
    expect(err).toMatchObject({ type: "hydrate-error", requestId: 3 });
  });

  it("on crash: rejects in-flight flushes, terminates, and respawns a fresh worker", async () => {
    const { executor, fakes } = harness({ poolSize: 1 });
    const streamId = "stream-A";

    const pending = executor.prepare({ ...FLUSH_ARGS, streamId });
    expect(fakes).toHaveLength(1);

    fakes[0]!.crash(new Error("segfault"));
    await expect(pending).rejects.toThrow(/crashed/);
    expect(fakes[0]!.terminated()).toBe(true);

    // A fresh worker was spawned for the same slot; the next flush goes there.
    expect(fakes).toHaveLength(2);
    const next = executor.prepare({ ...FLUSH_ARGS, streamId });
    const msg = fakes[1]!.posted[0]!;
    expect(msg.type).toBe("flush");
    if (msg.type !== "flush") throw new Error("unreachable");
    fakes[1]!.emit({ type: "flush-result", requestId: msg.requestId, plan: makePlan(streamId) });
    await expect(next).resolves.toMatchObject({ streamId });
  });

  it("a stale event from a replaced transport is ignored", async () => {
    const { executor, fakes } = harness({ poolSize: 1 });
    const streamId = "stream-A";
    executor.prepare({ ...FLUSH_ARGS, streamId }).catch(() => {});
    fakes[0]!.crash(new Error("first death"));
    expect(fakes).toHaveLength(2);
    // The OLD transport fires again (error + close both fire in practice); the
    // pool must not respawn a second time.
    fakes[0]!.crash(new Error("second, stale"));
    expect(fakes).toHaveLength(2);
  });

  it("after exceeding the crash budget the slot is declared dead and routes to the fallback", async () => {
    const { executor, fakes, fallback } = harness({ poolSize: 1 });
    const streamId = "stream-A";

    // 5 crashes within the window trips the budget. Each crash respawns until
    // the 5th, which marks the slot dead (no further respawn).
    for (let i = 0; i < 5; i++) {
      executor.prepare({ ...FLUSH_ARGS, streamId }).catch(() => {});
      fakes.at(-1)!.crash(new Error(`crash ${i}`));
    }
    const spawnedAfterBudget = fakes.length;

    const plan = await executor.prepare({ ...FLUSH_ARGS, streamId });
    expect(fallback.calls.prepare).toBe(1);
    expect(plan.streamId).toBe(streamId);
    // No new worker was spawned for the dead slot's flush.
    expect(fakes).toHaveLength(spawnedAfterBudget);

    executor.upsertUserPattern({ streamId, template: "t" });
    executor.removeUserPattern({ streamId, patternId: "p" });
    executor.setProtectedPatterns({ streamId, patternIds: ["p"] });
    expect(fallback.calls).toMatchObject({ upsert: 1, remove: 1, protected: 1 });
  });

  it("bumps a slot's protection epoch on respawn so ingest re-pushes to the fresh tree", () => {
    const { executor, fakes } = harness({ poolSize: 1 });
    const streamId = "stream-A";
    // A fresh pool starts at epoch 0 (no reset yet).
    expect(executor.protectionEpoch({ streamId })).toBe(0);

    executor.prepare({ ...FLUSH_ARGS, streamId }).catch(() => {});
    fakes[0]!.crash(new Error("segfault"));
    // The respawn lost the worker's tree; the epoch bump forces a re-push.
    expect(fakes).toHaveLength(2);
    expect(executor.protectionEpoch({ streamId })).toBe(1);
  });

  it("bumps the epoch and re-routes set-protected to the fallback once a slot is dead", () => {
    const { executor, fakes, fallback } = harness({ poolSize: 1 });
    const streamId = "stream-A";

    // Trip the crash budget: each crash bumps the epoch (4 respawns + the 5th
    // marking the slot dead), so the epoch reflects every lost-tree event.
    for (let i = 0; i < 5; i++) {
      executor.prepare({ ...FLUSH_ARGS, streamId }).catch(() => {});
      fakes.at(-1)!.crash(new Error(`crash ${i}`));
    }
    expect(executor.protectionEpoch({ streamId })).toBe(5);

    // The dead slot's referenced-set push now reaches the in-process fallback,
    // so the fallback tree re-pins the referenced patterns it never had.
    executor.setProtectedPatterns({ streamId, patternIds: ["p:a"] });
    expect(fallback.calls.protected).toBe(1);
  });

  it("proxies the three tree mutations to the owning worker", () => {
    const { executor, fakes } = harness({ poolSize: 1 });
    executor.upsertUserPattern({ streamId: "s", template: "user <*> in" });
    executor.removeUserPattern({ streamId: "s", patternId: "p1" });
    executor.setProtectedPatterns({ streamId: "s", patternIds: ["a", "b"] });
    expect(fakes[0]!.posted).toEqual([
      { type: "upsert-user-pattern", streamId: "s", template: "user <*> in" },
      { type: "remove-user-pattern", streamId: "s", patternId: "p1" },
      { type: "set-protected-patterns", streamId: "s", patternIds: ["a", "b"] },
    ]);
  });

  it("stop() acks each worker, terminates them, and stops the fallback", async () => {
    const { executor, fakes, fallback } = harness({ poolSize: 2 });
    const stopping = executor.stop();
    // Each worker was sent a stop; ack them.
    for (const fake of fakes) {
      const stopMsg = fake.posted.find((m) => m.type === "stop");
      expect(stopMsg).toBeDefined();
      if (stopMsg?.type === "stop") {
        fake.emit({ type: "stopped", requestId: stopMsg.requestId });
      }
    }
    await stopping;
    expect(fakes.every((f) => f.terminated())).toBe(true);
    expect(fallback.calls.stop).toBe(1);
  });

  it("rejects a poolSize below 1", () => {
    expect(() =>
      createWorkerFlushExecutor({
        poolSize: 0,
        loadPatternRows: async () => [],
        fallback: recordingFallback(),
        logger: createMockLogger(),
        spawn: () => fakeTransport().transport,
      }),
    ).toThrow(/poolSize/);
  });
});
