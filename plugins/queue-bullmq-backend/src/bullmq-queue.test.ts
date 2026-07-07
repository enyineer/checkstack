import { describe, expect, it, mock, beforeEach, afterAll } from "bun:test";
import * as realBullmq from "bullmq";

// Snapshot the real bullmq module before mocking; restore it in afterAll so the
// FakeQueue/FakeWorker stubs do not leak into other suites (mock.module is
// process-global and mock.restore() does not undo it).
const realBullmqModule = { ...realBullmq };

/**
 * Durability tuning unit test (reactive-automation-engine plan §15.4).
 *
 * Asserts that the BullMQ Worker is constructed with the explicit, intentional
 * lock/stalled tuning. The runtime stalled-redelivery behavior these options
 * govern is covered end-to-end by the env-gated integration test
 * `core/automation-backend/src/dispatch/stage2-stalled.it.test.ts`; this unit
 * test guards the construction contract without touching a real Redis.
 *
 * We intercept the `bullmq` module so neither the `Queue` nor the `Worker`
 * opens a connection, and capture the options passed to the `Worker`
 * constructor.
 */

interface CapturedWorkerOptions {
  lockDuration?: number;
  stalledInterval?: number;
  maxStalledCount?: number;
  concurrency?: number;
}

const workerOptionsCalls: CapturedWorkerOptions[] = [];

interface CapturedSchedulerCall {
  jobSchedulerId: string;
  repeat: {
    every?: number;
    pattern?: string;
    startDate?: number | string | Date;
  };
}

const schedulerCalls: CapturedSchedulerCall[] = [];

class FakeWorker {
  constructor(
    _name: string,
    _processor: unknown,
    options: CapturedWorkerOptions,
  ) {
    workerOptionsCalls.push(options);
  }
  on(): this {
    return this;
  }
  async close(): Promise<void> {}
}

class FakeQueue {
  constructor(
    public name: string,
    public opts: unknown,
  ) {}
  async upsertJobScheduler(
    jobSchedulerId: string,
    repeat: CapturedSchedulerCall["repeat"],
  ): Promise<void> {
    schedulerCalls.push({ jobSchedulerId, repeat });
  }
}

mock.module("bullmq", () => ({
  Queue: FakeQueue,
  Worker: FakeWorker,
}));

afterAll(() => {
  mock.module("bullmq", () => realBullmqModule);
});

// Import AFTER registering the module mock so the SUT picks up the fakes.
const { BullMQQueue } = await import("./bullmq-queue");
import type { BullMQConfig } from "./plugin";

const config: BullMQConfig = {
  host: "localhost",
  port: 6379,
  db: 0,
  keyPrefix: "checkstack:",
  concurrency: 10,
};

describe("BullMQQueue worker durability tuning (§15.4)", () => {
  beforeEach(() => {
    workerOptionsCalls.length = 0;
  });

  it("constructs the Worker with explicit lock/stalled tuning", async () => {
    const queue = new BullMQQueue("test-queue", config);
    await queue.consume(async () => {}, { consumerGroup: "group-a" });

    expect(workerOptionsCalls).toHaveLength(1);
    const opts = workerOptionsCalls[0]!;
    expect(opts.lockDuration).toBe(30_000);
    expect(opts.stalledInterval).toBe(30_000);
    expect(opts.maxStalledCount).toBe(1);
  });

  it("creates one Worker per consumer group (tuning applied each time)", async () => {
    const queue = new BullMQQueue("test-queue", config);
    await queue.consume(async () => {}, { consumerGroup: "group-a" });
    await queue.consume(async () => {}, { consumerGroup: "group-b" });
    // Re-consuming an existing group must NOT create a second Worker.
    await queue.consume(async () => {}, { consumerGroup: "group-a" });

    expect(workerOptionsCalls).toHaveLength(2);
    for (const opts of workerOptionsCalls) {
      expect(opts.lockDuration).toBe(30_000);
      expect(opts.stalledInterval).toBe(30_000);
      expect(opts.maxStalledCount).toBe(1);
    }
  });
});

describe("BullMQQueue recurring startDelay (herd de-clustering)", () => {
  beforeEach(() => {
    schedulerCalls.length = 0;
  });

  it("pins the first fire to now + startDelay via startDate on the every path", async () => {
    const queue = new BullMQQueue<{ v: number }>("test-queue", config);

    const before = Date.now();
    await queue.scheduleRecurring(
      { v: 1 },
      { jobId: "check:a", intervalSeconds: 60, startDelay: 12 },
    );
    const after = Date.now();

    expect(schedulerCalls).toHaveLength(1);
    const { repeat } = schedulerCalls[0]!;
    expect(repeat.every).toBe(60_000);
    // startDate is a future ms timestamp ~ now + 12s (bracketed by the call).
    expect(typeof repeat.startDate).toBe("number");
    const startDate = repeat.startDate as number;
    expect(startDate).toBeGreaterThanOrEqual(before + 12_000);
    expect(startDate).toBeLessThanOrEqual(after + 12_000);
  });

  it("omits startDate when no startDelay is given (unchanged immediate first fire)", async () => {
    const queue = new BullMQQueue<{ v: number }>("test-queue", config);

    await queue.scheduleRecurring(
      { v: 1 },
      { jobId: "check:b", intervalSeconds: 30 },
    );

    expect(schedulerCalls).toHaveLength(1);
    const { repeat } = schedulerCalls[0]!;
    expect(repeat.every).toBe(30_000);
    expect(repeat.startDate).toBeUndefined();
  });

  it("does not apply startDelay to a cron schedule", async () => {
    const queue = new BullMQQueue<{ v: number }>("test-queue", config);

    await queue.scheduleRecurring(
      { v: 1 },
      { jobId: "check:c", cronPattern: "0 * * * *", startDelay: 12 },
    );

    expect(schedulerCalls).toHaveLength(1);
    const { repeat } = schedulerCalls[0]!;
    expect(repeat.pattern).toBe("0 * * * *");
    expect(repeat.every).toBeUndefined();
    expect(repeat.startDate).toBeUndefined();
  });
});
