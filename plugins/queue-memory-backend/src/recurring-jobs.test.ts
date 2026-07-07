/**
 * Recurring Job Tests for InMemoryQueue
 *
 * Uses Bun's Jest-compatible fake timers (`jest.useFakeTimers`,
 * `jest.advanceTimersByTime`) so interval-based recurring scheduling is driven
 * deterministically instead of via real `Bun.sleep` waits. Real-time waits in
 * the unit lane are a known flake source under the parallel runner; advancing a
 * fake clock makes each "after N intervals" assertion exact and fast.
 */

import {
  describe,
  it,
  expect,
  afterEach,
  beforeEach,
  jest,
  setSystemTime,
} from "bun:test";
import { InMemoryQueue } from "./memory-queue";
import type { Logger } from "@checkstack/backend-api";

const testLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function createTestQueue(name: string) {
  return new InMemoryQueue<string>(
    name,
    {
      concurrency: 10,
      maxQueueSize: 100,
      // Real timing (multiplier 1) so advancing the fake clock by the interval
      // in ms maps 1:1 to a scheduled fire.
      delayMultiplier: 1,
      heartbeatIntervalMs: 100,
    },
    testLogger,
  );
}

/**
 * Advance the fake clock by `ms` and let the queue's async processing
 * (enqueue -> processNext -> async consumer) drain. Several microtask flushes
 * cover the multi-hop async path between a timer firing and the handler
 * completing.
 */
async function advanceAndDrain(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe("InMemoryQueue Recurring Jobs", () => {
  let queue: InMemoryQueue<string> | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    setSystemTime(new Date("2026-01-18T10:00:00Z"));
  });

  afterEach(async () => {
    jest.useRealTimers();
    if (queue) {
      await queue.stop();
      queue = undefined;
    }
  });

  it("should reschedule recurring job after successful execution", async () => {
    queue = createTestQueue("test-reschedule");

    let executionCount = 0;
    await queue.consume(
      async () => {
        executionCount++;
      },
      { consumerGroup: "test", maxRetries: 0 },
    );

    await queue.scheduleRecurring("payload", {
      jobId: "recurring-success",
      intervalSeconds: 1,
    });

    // Two intervals -> at least two executions (re-scheduled after each run).
    await advanceAndDrain(1000);
    await advanceAndDrain(1000);

    expect(executionCount).toBeGreaterThanOrEqual(2);
  });

  it("should reschedule recurring job even after handler failure", async () => {
    queue = createTestQueue("test-failure-reschedule");

    let executionCount = 0;
    await queue.consume(
      async () => {
        executionCount++;
        throw new Error("Handler failed");
      },
      { consumerGroup: "test", maxRetries: 0 },
    );

    await queue.scheduleRecurring("payload", {
      jobId: "recurring-failure",
      intervalSeconds: 1,
    });

    await advanceAndDrain(1000);
    await advanceAndDrain(1000);

    // Should still reschedule despite failures
    expect(executionCount).toBeGreaterThanOrEqual(2);
  });

  it("should not reschedule during retries", async () => {
    queue = createTestQueue("test-no-reschedule-during-retry");

    let attempts = 0;
    let completed = false;

    await queue.consume(
      async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("Retry me");
        }
        completed = true;
      },
      { consumerGroup: "test", maxRetries: 5 },
    );

    await queue.scheduleRecurring("payload", {
      jobId: "recurring-retry",
      intervalSeconds: 60, // Long interval so only retries should execute
    });

    // Retries use exponential backoff (2s, then 4s) on their own delayed
    // schedule. Drain past the full backoff window (~6s) but stay well under
    // the 60s recurring interval, so only retries — not a reschedule — run.
    await advanceAndDrain(3000);
    await advanceAndDrain(5000);

    // Should complete after retries, not reschedule
    expect(completed).toBe(true);
    expect(attempts).toBe(3);
  });

  it("should stop scheduling when cancelled", async () => {
    queue = createTestQueue("test-cancel");

    let executionCount = 0;
    await queue.consume(
      async () => {
        executionCount++;
      },
      { consumerGroup: "test", maxRetries: 0 },
    );

    await queue.scheduleRecurring("payload", {
      jobId: "recurring-cancel",
      intervalSeconds: 1,
    });

    await advanceAndDrain(1000);
    const countBeforeCancel = executionCount;

    await queue.cancelRecurring("recurring-cancel");
    await advanceAndDrain(2000);

    // Should not have executed more after cancellation
    expect(countBeforeCancel).toBeGreaterThanOrEqual(1);
    expect(executionCount).toBe(countBeforeCancel);
  });

  it("should update recurring job when called with same jobId", async () => {
    queue = createTestQueue("test-update");

    const payloads: string[] = [];
    await queue.consume(
      async (job) => {
        payloads.push(job.data);
      },
      { consumerGroup: "test", maxRetries: 0 },
    );

    // Schedule with original payload on a slow interval.
    await queue.scheduleRecurring("original-payload", {
      jobId: "recurring-update",
      intervalSeconds: 10,
    });

    await advanceAndDrain(2000);

    // Update to new payload and a faster interval.
    await queue.scheduleRecurring("updated-payload", {
      jobId: "recurring-update",
      intervalSeconds: 1,
    });

    await advanceAndDrain(1000);
    await advanceAndDrain(1000);

    // Should have the updated payload multiple times.
    const updatedPayloads = payloads.filter((p) => p === "updated-payload");
    expect(updatedPayloads.length).toBeGreaterThanOrEqual(2);
  });

  it("honors startDelay: the first execution waits out the delay", async () => {
    queue = createTestQueue("test-start-delay");

    let executionCount = 0;
    await queue.consume(
      async () => {
        executionCount++;
      },
      { consumerGroup: "test", maxRetries: 0 },
    );

    await queue.scheduleRecurring("payload", {
      jobId: "delayed-start",
      intervalSeconds: 1,
      startDelay: 5, // 5s before the FIRST fire (contract: not immediate)
    });

    // Before the delay elapses, nothing has fired - the old behavior would have
    // fired immediately at t=0 (startDelay was silently dropped).
    await advanceAndDrain(4000);
    expect(executionCount).toBe(0);

    // Once the delay passes, the first execution lands.
    await advanceAndDrain(2000); // t = 6s
    expect(executionCount).toBeGreaterThanOrEqual(1);
  });

  it("anchors the recurrence to the delayed first fire (phase shift persists)", async () => {
    queue = createTestQueue("test-start-delay-phase");

    const fireTimes: number[] = [];
    await queue.consume(
      async () => {
        fireTimes.push(Date.now());
      },
      { consumerGroup: "test", maxRetries: 0 },
    );

    const t0 = Date.now();
    await queue.scheduleRecurring("payload", {
      jobId: "delayed-phase",
      intervalSeconds: 10,
      startDelay: 3,
    });

    // Nothing before the 3s delay.
    await advanceAndDrain(2500);
    expect(fireTimes.length).toBe(0);

    // First fire ~t0 + 3s (the phase boundary).
    await advanceAndDrain(1000); // t = 3.5s
    expect(fireTimes.length).toBe(1);
    expect(fireTimes[0] - t0).toBeGreaterThanOrEqual(3000);

    // Next fire one interval AFTER the delayed first fire (~t0 + 13s), i.e. the
    // schedule keeps its phase offset instead of snapping to a boot-anchored
    // grid - this is what de-clusters equal-interval checks.
    await advanceAndDrain(10000); // t = 13.5s
    expect(fireTimes.length).toBe(2);
    expect(fireTimes[1] - fireTimes[0]).toBeGreaterThanOrEqual(9000);
  });

  it("should cancel old interval and pending jobs when updating", async () => {
    queue = createTestQueue("test-update-cancels-old");

    let executionCount = 0;
    await queue.consume(
      async () => {
        executionCount++;
      },
      { consumerGroup: "test", maxRetries: 0 },
    );

    // Schedule with a long interval (won't fire again during the test).
    await queue.scheduleRecurring("payload", {
      jobId: "recurring-test",
      intervalSeconds: 100, // Very long, should only execute once initially
    });

    await advanceAndDrain(2000);
    const countAfterFirst = executionCount;

    // Update to a short interval.
    await queue.scheduleRecurring("payload", {
      jobId: "recurring-test",
      intervalSeconds: 1,
    });

    await advanceAndDrain(1000);
    await advanceAndDrain(1000);

    // Should have executed multiple times with the new interval.
    expect(executionCount).toBeGreaterThan(countAfterFirst);
    expect(executionCount - countAfterFirst).toBeGreaterThanOrEqual(2);
  });
});
