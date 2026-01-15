/**
 * Recurring Job Tests for InMemoryQueue
 */

import { describe, it, expect, afterEach } from "bun:test";
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
      delayMultiplier: 0.01, // Speed up delays for testing
      heartbeatIntervalMs: 5,
    },
    testLogger
  );
}

describe("InMemoryQueue Recurring Jobs", () => {
  let queue: InMemoryQueue<string> | undefined;

  afterEach(async () => {
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
      { consumerGroup: "test", maxRetries: 0 }
    );

    await queue.scheduleRecurring("payload", {
      jobId: "recurring-success",
      intervalSeconds: 0.5, // 5ms with multiplier
    });

    // Wait for multiple executions
    await Bun.sleep(100);

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
      { consumerGroup: "test", maxRetries: 0 }
    );

    await queue.scheduleRecurring("payload", {
      jobId: "recurring-failure",
      intervalSeconds: 0.5,
    });

    await Bun.sleep(100);

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
      { consumerGroup: "test", maxRetries: 5 }
    );

    await queue.scheduleRecurring("payload", {
      jobId: "recurring-retry",
      intervalSeconds: 60, // Long interval so only retries should execute
    });

    await Bun.sleep(200);

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
      { consumerGroup: "test", maxRetries: 0 }
    );

    await queue.scheduleRecurring("payload", {
      jobId: "recurring-cancel",
      intervalSeconds: 0.5,
    });

    await Bun.sleep(50);
    const countBeforeCancel = executionCount;

    await queue.cancelRecurring("recurring-cancel");
    await Bun.sleep(100);

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
      { consumerGroup: "test", maxRetries: 0 }
    );

    // Schedule with original payload
    await queue.scheduleRecurring("original-payload", {
      jobId: "recurring-update",
      intervalSeconds: 5, // 50ms with multiplier - slow interval
    });

    await Bun.sleep(20);

    // Update to new payload and faster interval
    await queue.scheduleRecurring("updated-payload", {
      jobId: "recurring-update",
      intervalSeconds: 0.5, // 5ms with multiplier
    });

    await Bun.sleep(80);

    // Should have the updated payload multiple times
    const updatedPayloads = payloads.filter((p) => p === "updated-payload");
    expect(updatedPayloads.length).toBeGreaterThanOrEqual(2);
  });

  it("should cancel old interval and pending jobs when updating", async () => {
    queue = createTestQueue("test-update-cancels-old");

    let executionCount = 0;
    await queue.consume(
      async () => {
        executionCount++;
      },
      { consumerGroup: "test", maxRetries: 0 }
    );

    // Schedule with a long interval (won't fire again during test)
    await queue.scheduleRecurring("payload", {
      jobId: "recurring-test",
      intervalSeconds: 100, // Very long, should only execute once initially
    });

    await Bun.sleep(30);
    const countAfterFirst = executionCount;

    // Update to a short interval
    await queue.scheduleRecurring("payload", {
      jobId: "recurring-test",
      intervalSeconds: 0.5, // 5ms with multiplier
    });

    await Bun.sleep(80);

    // Should have executed multiple times with new interval
    expect(executionCount).toBeGreaterThan(countAfterFirst);
    expect(executionCount - countAfterFirst).toBeGreaterThanOrEqual(2);
  });
});
