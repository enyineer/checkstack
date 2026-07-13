import { describe, it, expect } from "bun:test";
import type { Logger } from "@checkstack/backend-api";
import {
  createFastPath,
  shouldFastPath,
  type EnqueueRun,
  type StreamAssignment,
} from "./fast-path";
import { fastPathJobId, FAST_PATH_DEBOUNCE_MS } from "./constants";

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
  // A gate every enqueue awaits, so a test can hold the enqueue in-flight to
  // observe that the hook already returned. Open it with `resolveNext()`.
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

/** A resolver returning fixed assignments, each defaulting to one env-less run. */
function fixedAssignments(
  assignments: StreamAssignment[],
): (streamId: string) => Promise<StreamAssignment[]> {
  return async () => assignments;
}

describe("shouldFastPath", () => {
  it("triggers only for error and fatal bands", () => {
    expect(shouldFastPath("fatal")).toBe(true);
    expect(shouldFastPath("error")).toBe(true);
    expect(shouldFastPath("warn")).toBe(false);
    expect(shouldFastPath("info")).toBe(false);
    expect(shouldFastPath("debug")).toBe(false);
    expect(shouldFastPath("trace")).toBe(false);
  });
});

describe("fastPathJobId", () => {
  it("is stable within a debounce bucket and changes across buckets", () => {
    // Align to a debounce-bucket boundary so `base` and `base + 14999ms` share
    // a bucket and `base + 15000ms` rolls to the next.
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
    expect(a).toMatch(/^logstream-fast:c1:s1:_:\d+$/);
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

  it("enqueues one debounced run per assignment when worstBand >= error", async () => {
    const { enqueue, calls, resolveNext } = recordingEnqueue();
    resolveNext();
    const onFlush = createFastPath({
      resolveAssignments: fixedAssignments(assignments),
      enqueueRun: enqueue,
      logger: noopLogger,
      now: () => 1_000_000_000_000,
    });

    onFlush({ streamId: "stream-1", worstBand: "error", errorDelta: 3 });
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

    onFlush({ streamId: "stream-1", worstBand: "fatal", errorDelta: 5 });
    await onFlush.whenIdle();

    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.environmentId).sort()).toEqual(["env-a", "env-b"]);
    // Distinct jobIds so BullMQ does not collapse the two env slices.
    expect(new Set(calls.map((c) => c.jobId)).size).toBe(2);
  });

  it("does nothing when worstBand is below error", async () => {
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
    onFlush({ streamId: "stream-1", worstBand: "warn", errorDelta: 0 });
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
    onFlush({ streamId: "stream-1", worstBand: "fatal", errorDelta: 9 });
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
    // The hook is synchronous and must not throw even though the fan-out rejects.
    expect(() =>
      onFlush({ streamId: "stream-1", worstBand: "error", errorDelta: 1 }),
    ).not.toThrow();
    await onFlush.whenIdle();
    expect(calls).toHaveLength(0);
  });

  it("skips enqueues on a repeat flush within the same debounce bucket", async () => {
    const { enqueue, calls, resolveNext } = recordingEnqueue();
    resolveNext();
    // Align to a debounce-bucket boundary so `+5s` stays in the bucket.
    let nowMs =
      Math.floor(1_000_000_000_000 / FAST_PATH_DEBOUNCE_MS) *
      FAST_PATH_DEBOUNCE_MS;
    const onFlush = createFastPath({
      resolveAssignments: fixedAssignments(assignments),
      enqueueRun: enqueue,
      logger: noopLogger,
      now: () => nowMs,
    });

    onFlush({ streamId: "stream-1", worstBand: "error", errorDelta: 3 });
    await onFlush.whenIdle();
    expect(calls).toHaveLength(2);

    // Second flush a few seconds later - SAME 15s bucket - enqueues nothing.
    nowMs += 5_000;
    onFlush({ streamId: "stream-1", worstBand: "error", errorDelta: 4 });
    await onFlush.whenIdle();
    expect(calls).toHaveLength(2);

    // A flush in the NEXT bucket enqueues again.
    nowMs += FAST_PATH_DEBOUNCE_MS;
    onFlush({ streamId: "stream-1", worstBand: "error", errorDelta: 1 });
    await onFlush.whenIdle();
    expect(calls).toHaveLength(4);
  });

  it("returns synchronously without awaiting the enqueue (flush loop never blocks)", async () => {
    const { enqueue, calls, resolveNext } = recordingEnqueue();
    // Do NOT release the enqueue gate yet: the enqueue is in-flight.
    const onFlush = createFastPath({
      resolveAssignments: fixedAssignments(assignments),
      enqueueRun: enqueue,
      logger: noopLogger,
      now: () => 1_000_000_000_000,
    });

    const returned = onFlush({
      streamId: "stream-1",
      worstBand: "error",
      errorDelta: 3,
    });
    // The hook returned void immediately even though the enqueue is still gated.
    expect(returned).toBeUndefined();
    expect(calls).toHaveLength(0);

    // Once the gate opens, the detached fan-out completes.
    resolveNext();
    await onFlush.whenIdle();
    expect(calls).toHaveLength(2);
  });
});
