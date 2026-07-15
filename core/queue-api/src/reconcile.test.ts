import { describe, it, expect } from "bun:test";
import type { Queue } from "./queue";
import { reconcileRecurringJobs, type RecurringJobSpec } from "./reconcile";

interface TestPayload {
  ref: string;
}

/**
 * A minimal in-memory Queue whose recurring-job methods are real (the rest are
 * inert). queue-api sits below test-utils-backend, so we build the fake here
 * rather than importing `createMockQueueManager` (which would be a cycle).
 */
function memoryQueue(): {
  queue: Queue<TestPayload>;
  recurring: Map<string, { data: TestPayload; intervalSeconds: number }>;
  calls: { scheduled: string[]; cancelled: string[] };
} {
  const recurring = new Map<
    string,
    { data: TestPayload; intervalSeconds: number }
  >();
  const calls = { scheduled: [] as string[], cancelled: [] as string[] };

  const queue: Queue<TestPayload> = {
    enqueue: async () => "job",
    consume: async () => {},
    scheduleRecurring: async (data, options) => {
      // The helper only ever schedules interval jobs (never cron).
      recurring.set(options.jobId, {
        data,
        intervalSeconds: options.intervalSeconds ?? 0,
      });
      calls.scheduled.push(options.jobId);
      return options.jobId;
    },
    cancelRecurring: async (jobId) => {
      recurring.delete(jobId);
      calls.cancelled.push(jobId);
    },
    listRecurringJobs: async () => [...recurring.keys()],
    getRecurringJobDetails: async (jobId) => {
      const job = recurring.get(jobId);
      return job
        ? { jobId, data: job.data, intervalSeconds: job.intervalSeconds }
        : undefined;
    },
    getInFlightCount: async () => 0,
    testConnection: async () => {},
    stop: async () => {},
    getStats: async () => ({
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      consumerGroups: 0,
      scope: "instance" as const,
    }),
    listJobs: async () => ({ items: [], total: 0, hasMore: false }),
  };

  return { queue, recurring, calls };
}

const owns = (jobId: string): boolean => jobId.startsWith("mine:");

describe("reconcileRecurringJobs", () => {
  it("schedules every desired job and reports them", async () => {
    const { queue, recurring, calls } = memoryQueue();

    const result = await reconcileRecurringJobs({
      queue,
      desired: [
        { jobId: "mine:a", intervalSeconds: 30, data: { ref: "a" } },
        { jobId: "mine:b", intervalSeconds: 60, data: { ref: "b" } },
      ],
      ownsJobId: owns,
    });

    expect([...recurring.keys()].toSorted()).toEqual(["mine:a", "mine:b"]);
    expect(recurring.get("mine:a")?.intervalSeconds).toBe(30);
    expect(result.scheduled.toSorted()).toEqual(["mine:a", "mine:b"]);
    expect(result.cancelled).toEqual([]);
    expect(calls.cancelled).toEqual([]);
  });

  it("updates the interval of an existing job in place (idempotent jobId)", async () => {
    const { queue, recurring } = memoryQueue();

    await reconcileRecurringJobs({
      queue,
      desired: [{ jobId: "mine:a", intervalSeconds: 30, data: { ref: "a" } }],
      ownsJobId: owns,
    });
    await reconcileRecurringJobs({
      queue,
      desired: [{ jobId: "mine:a", intervalSeconds: 90, data: { ref: "a" } }],
      ownsJobId: owns,
    });

    expect([...recurring.keys()]).toEqual(["mine:a"]);
    expect(recurring.get("mine:a")?.intervalSeconds).toBe(90);
  });

  it("cancels owned jobs that are no longer desired", async () => {
    const { queue, recurring, calls } = memoryQueue();
    await queue.scheduleRecurring(
      { ref: "gone" },
      { jobId: "mine:gone", intervalSeconds: 30 },
    );
    await queue.scheduleRecurring(
      { ref: "keep" },
      { jobId: "mine:keep", intervalSeconds: 30 },
    );

    const result = await reconcileRecurringJobs({
      queue,
      desired: [{ jobId: "mine:keep", intervalSeconds: 30, data: { ref: "keep" } }],
      ownsJobId: owns,
    });

    expect([...recurring.keys()]).toEqual(["mine:keep"]);
    expect(result.cancelled).toEqual(["mine:gone"]);
    expect(calls.cancelled).toEqual(["mine:gone"]);
  });

  it("never cancels jobs the predicate does not own", async () => {
    const { queue, recurring } = memoryQueue();
    // Another plugin's job and the reconcile job itself - neither is "mine:".
    await queue.scheduleRecurring(
      { ref: "other" },
      { jobId: "other:x", intervalSeconds: 30 },
    );
    await queue.scheduleRecurring(
      { ref: "reconcile" },
      { jobId: "reconcile", intervalSeconds: 60 },
    );

    await reconcileRecurringJobs({ queue, desired: [], ownsJobId: owns });

    expect([...recurring.keys()].toSorted()).toEqual(["other:x", "reconcile"]);
  });

  it("cancels an owned orphan while scheduling a new desired job in one pass", async () => {
    const { queue, recurring, calls } = memoryQueue();
    await queue.scheduleRecurring(
      { ref: "old" },
      { jobId: "mine:old", intervalSeconds: 30 },
    );

    const result = await reconcileRecurringJobs({
      queue,
      desired: [{ jobId: "mine:new", intervalSeconds: 45, data: { ref: "new" } }],
      ownsJobId: owns,
    });

    expect([...recurring.keys()]).toEqual(["mine:new"]);
    expect(result.scheduled).toEqual(["mine:new"]);
    expect(result.cancelled).toEqual(["mine:old"]);
    expect(calls.cancelled).toEqual(["mine:old"]);
  });

  it("is idempotent across repeated runs", async () => {
    const { queue, recurring, calls } = memoryQueue();
    const desired: RecurringJobSpec<TestPayload>[] = [
      { jobId: "mine:a", intervalSeconds: 30, data: { ref: "a" } },
    ];

    await reconcileRecurringJobs({ queue, desired, ownsJobId: owns });
    const afterFirst = [...recurring.keys()];
    const cancelledBefore = calls.cancelled.length;

    const second = await reconcileRecurringJobs({ queue, desired, ownsJobId: owns });

    expect([...recurring.keys()]).toEqual(afterFirst);
    expect(second.cancelled).toEqual([]);
    expect(calls.cancelled.length).toBe(cancelledBefore);
  });
});
