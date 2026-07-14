import { describe, it, expect } from "bun:test";
import type { Logger } from "@checkstack/backend-api";
import {
  fastPathJobId as sharedFastPathJobId,
  FAST_PATH_DEBOUNCE_MS,
  type HealthCheckJobPayload,
} from "@checkstack/healthcheck-common";
import {
  createFastPath,
  shouldFastPath,
  type EnqueueRun,
  type StreamAssignment,
} from "./fast-path";
import { TRACESTREAM_FAST_PATH_PREFIX } from "./constants";

/**
 * This plugin always builds fast-path ids with the tracestream prefix; the
 * wrapper keeps the call sites (and the byte-identical `tracestream-fast:...`
 * id shape asserted below) unchanged after the shared-module extraction.
 */
function fastPathJobId(args: {
  configId: string;
  systemId: string;
  environmentId: string | null;
  nowMs: number;
}): string {
  return sharedFastPathJobId({ prefix: TRACESTREAM_FAST_PATH_PREFIX, ...args });
}

const noopLogger: Logger = {
  info() {},
  error() {},
  warn() {},
  debug() {},
};

interface Enqueued {
  configId: string;
  systemId: string;
  environmentId: string | null;
  jobId: string;
}

function recordingEnqueue(): {
  enqueue: EnqueueRun;
  calls: Enqueued[];
  resolveNext: () => void;
} {
  const calls: Enqueued[] = [];
  const holder: { release: () => void } = { release: () => {} };
  const gate = new Promise<void>((resolve) => {
    holder.release = resolve;
  });
  const enqueue: EnqueueRun = async ({ payload, jobId }) => {
    await gate;
    calls.push({ ...payload, jobId });
  };
  return { enqueue, calls, resolveNext: () => holder.release() };
}

function fixedAssignments(
  assignments: StreamAssignment[],
): (streamId: string) => Promise<StreamAssignment[]> {
  return async () => assignments;
}

/** Enqueue that throws the next time it is called, then succeeds (Redis blip). */
function flakyEnqueue(): {
  enqueue: EnqueueRun;
  calls: Enqueued[];
  failNext: () => void;
} {
  const calls: Enqueued[] = [];
  let fail = false;
  const enqueue: EnqueueRun = async ({ payload, jobId }) => {
    if (fail) {
      fail = false;
      throw new Error("redis down");
    }
    calls.push({ ...payload, jobId });
  };
  return { enqueue, calls, failNext: () => (fail = true) };
}

describe("shouldFastPath", () => {
  it("triggers only when the flush committed error spans", () => {
    expect(shouldFastPath(1)).toBe(true);
    expect(shouldFastPath(9)).toBe(true);
    expect(shouldFastPath(0)).toBe(false);
  });
});

describe("fastPathJobId", () => {
  it("is stable within a debounce bucket and changes across buckets", () => {
    const base =
      Math.floor(1_000_000_000_000 / FAST_PATH_DEBOUNCE_MS) *
      FAST_PATH_DEBOUNCE_MS;
    const a = fastPathJobId({
      configId: "c1",
      systemId: "s1",
      environmentId: null,
      nowMs: base,
    });
    const b = fastPathJobId({
      configId: "c1",
      systemId: "s1",
      environmentId: null,
      nowMs: base + FAST_PATH_DEBOUNCE_MS - 1,
    });
    const c = fastPathJobId({
      configId: "c1",
      systemId: "s1",
      environmentId: null,
      nowMs: base + FAST_PATH_DEBOUNCE_MS,
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^tracestream-fast:c1:s1:_:\d+$/);
  });

  it("distinguishes per-environment slices in the same bucket", () => {
    const nowMs = 1_000_000_000_000;
    const envA = fastPathJobId({
      configId: "c1",
      systemId: "s1",
      environmentId: "env-a",
      nowMs,
    });
    const envB = fastPathJobId({
      configId: "c1",
      systemId: "s1",
      environmentId: "env-b",
      nowMs,
    });
    const envless = fastPathJobId({
      configId: "c1",
      systemId: "s1",
      environmentId: null,
      nowMs,
    });
    expect(new Set([envA, envB, envless]).size).toBe(3);
  });
});

describe("createFastPath fan-out", () => {
  const assignments: StreamAssignment[] = [
    { configId: "c1", systemId: "sysA", environmentIds: [null] },
    { configId: "c1", systemId: "sysB", environmentIds: [null] },
  ];

  it("enqueues one debounced run per assignment when the flush had error spans", async () => {
    const { enqueue, calls, resolveNext } = recordingEnqueue();
    resolveNext();
    const onFlush = createFastPath({
      resolveAssignments: fixedAssignments(assignments),
      enqueueRun: enqueue,
      logger: noopLogger,
      now: () => 1_000_000_000_000,
    });

    onFlush({ streamId: "stream-1", errorSpanCount: 3 });
    await onFlush.whenIdle();

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      configId: "c1",
      systemId: "sysA",
      environmentId: null,
      jobId: fastPathJobId({
        configId: "c1",
        systemId: "sysA",
        environmentId: null,
        nowMs: 1_000_000_000_000,
      }),
    });
    expect(calls[1].systemId).toBe("sysB");
  });

  it("enqueues a payload matching the shared HealthCheckJobPayload shape", async () => {
    // The payload IS healthcheck-common's HealthCheckJobPayload now (the
    // fast-path enqueues that shared type), so drift protection is by
    // construction; this keeps a slim runtime assertion on the enqueued object.
    const { enqueue, calls, resolveNext } = recordingEnqueue();
    resolveNext();
    const onFlush = createFastPath({
      resolveAssignments: fixedAssignments([
        { configId: "c1", systemId: "sysA", environmentIds: ["env-a"] },
      ]),
      enqueueRun: enqueue,
      logger: noopLogger,
      now: () => 1_000_000_000_000,
    });
    onFlush({ streamId: "stream-1", errorSpanCount: 5 });
    await onFlush.whenIdle();

    expect(calls).toHaveLength(1);
    const { jobId, ...rest } = calls[0]!;
    // Assignable to the shared payload type (compile-time drift guard).
    const payload: HealthCheckJobPayload = rest;
    expect(jobId).toBeString();
    expect(Object.keys(payload).sort()).toEqual([
      "configId",
      "environmentId",
      "systemId",
    ]);
    expect(payload).toEqual({
      configId: "c1",
      systemId: "sysA",
      environmentId: "env-a",
    });
  });

  it("enqueues one run per effective environment slice", async () => {
    const { enqueue, calls, resolveNext } = recordingEnqueue();
    resolveNext();
    const onFlush = createFastPath({
      resolveAssignments: fixedAssignments([
        { configId: "c1", systemId: "sysA", environmentIds: ["env-a", "env-b"] },
      ]),
      enqueueRun: enqueue,
      logger: noopLogger,
      now: () => 1_000_000_000_000,
    });

    onFlush({ streamId: "stream-1", errorSpanCount: 5 });
    await onFlush.whenIdle();

    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.environmentId).sort()).toEqual(["env-a", "env-b"]);
    expect(new Set(calls.map((c) => c.jobId)).size).toBe(2);
  });

  it("does nothing when the flush committed no error spans", async () => {
    const { enqueue, calls, resolveNext } = recordingEnqueue();
    resolveNext();
    let resolved = false;
    const onFlush = createFastPath({
      resolveAssignments: async () => {
        resolved = true;
        return assignments;
      },
      enqueueRun: enqueue,
      logger: noopLogger,
    });
    onFlush({ streamId: "stream-1", errorSpanCount: 0 });
    await onFlush.whenIdle();
    expect(calls).toHaveLength(0);
    expect(resolved).toBe(false);
  });

  it("enqueues nothing when the stream has no assignments", async () => {
    const { enqueue, calls, resolveNext } = recordingEnqueue();
    resolveNext();
    const onFlush = createFastPath({
      resolveAssignments: fixedAssignments([]),
      enqueueRun: enqueue,
      logger: noopLogger,
    });
    onFlush({ streamId: "stream-1", errorSpanCount: 9 });
    await onFlush.whenIdle();
    expect(calls).toHaveLength(0);
  });

  it("never throws when discovery fails (best-effort)", async () => {
    const { enqueue, calls, resolveNext } = recordingEnqueue();
    resolveNext();
    const onFlush = createFastPath({
      resolveAssignments: async () => {
        throw new Error("healthcheck RPC down");
      },
      enqueueRun: enqueue,
      logger: noopLogger,
    });
    expect(() =>
      onFlush({ streamId: "stream-1", errorSpanCount: 1 }),
    ).not.toThrow();
    await onFlush.whenIdle();
    expect(calls).toHaveLength(0);
  });

  it("skips enqueues on a repeat flush within the same debounce bucket", async () => {
    const { enqueue, calls, resolveNext } = recordingEnqueue();
    resolveNext();
    let nowMs =
      Math.floor(1_000_000_000_000 / FAST_PATH_DEBOUNCE_MS) *
      FAST_PATH_DEBOUNCE_MS;
    const onFlush = createFastPath({
      resolveAssignments: fixedAssignments(assignments),
      enqueueRun: enqueue,
      logger: noopLogger,
      now: () => nowMs,
    });

    onFlush({ streamId: "stream-1", errorSpanCount: 3 });
    await onFlush.whenIdle();
    expect(calls).toHaveLength(2);

    // Second flush a few seconds later - SAME 15s bucket - enqueues nothing.
    nowMs += 5_000;
    onFlush({ streamId: "stream-1", errorSpanCount: 4 });
    await onFlush.whenIdle();
    expect(calls).toHaveLength(2);

    // A flush in the NEXT bucket enqueues again.
    nowMs += FAST_PATH_DEBOUNCE_MS;
    onFlush({ streamId: "stream-1", errorSpanCount: 1 });
    await onFlush.whenIdle();
    expect(calls).toHaveLength(4);
  });

  it("re-enqueues in the SAME bucket after an enqueue failure (unmark on failure)", async () => {
    const { enqueue, calls, failNext } = flakyEnqueue();
    const nowMs =
      Math.floor(1_000_000_000_000 / FAST_PATH_DEBOUNCE_MS) *
      FAST_PATH_DEBOUNCE_MS;
    const onFlush = createFastPath({
      resolveAssignments: fixedAssignments([
        { configId: "c1", systemId: "sysA", environmentIds: [null] },
      ]),
      enqueueRun: enqueue,
      logger: noopLogger,
      now: () => nowMs,
    });

    // First flush: the enqueue rejects, so the slice's mark is rolled back.
    failNext();
    onFlush({ streamId: "stream-1", errorSpanCount: 3 });
    await onFlush.whenIdle();
    expect(calls).toHaveLength(0);

    // Second flush in the SAME debounce bucket must retry (mark was unmarked),
    // instead of silently doing nothing for the rest of the bucket.
    onFlush({ streamId: "stream-1", errorSpanCount: 3 });
    await onFlush.whenIdle();
    expect(calls).toHaveLength(1);
    expect(calls[0].systemId).toBe("sysA");
  });

  it("returns synchronously without awaiting the enqueue (flush loop never blocks)", async () => {
    const { enqueue, calls, resolveNext } = recordingEnqueue();
    const onFlush = createFastPath({
      resolveAssignments: fixedAssignments(assignments),
      enqueueRun: enqueue,
      logger: noopLogger,
      now: () => 1_000_000_000_000,
    });

    const returned = onFlush({ streamId: "stream-1", errorSpanCount: 3 });
    expect(returned).toBeUndefined();
    expect(calls).toHaveLength(0);

    resolveNext();
    await onFlush.whenIdle();
    expect(calls).toHaveLength(2);
  });
});
