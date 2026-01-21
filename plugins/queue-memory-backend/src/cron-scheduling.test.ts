/**
 * Cron Scheduling Tests for InMemoryQueue
 *
 * Uses Bun's Jest-compatible fake timers (`jest.useFakeTimers`, `jest.advanceTimersByTime`)
 * to test cron scheduling without waiting for real time to pass.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
  setSystemTime,
  mock,
} from "bun:test";
import { InMemoryQueue } from "./memory-queue";
import type { Logger } from "@checkstack/backend-api";

const mockError = mock(() => {});
const testLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: mockError,
};

function createTestQueue(name: string) {
  return new InMemoryQueue<string>(
    name,
    {
      concurrency: 10,
      maxQueueSize: 100,
      delayMultiplier: 1, // Use real timing for cron tests
      heartbeatIntervalMs: 100,
    },
    testLogger,
  );
}

describe("InMemoryQueue Cron Scheduling", () => {
  let queue: InMemoryQueue<string> | undefined;

  beforeEach(() => {
    // Enable fake timers with initial time
    jest.useFakeTimers();
    setSystemTime(new Date("2026-01-18T10:00:00Z"));
    mockError.mockClear();
  });

  afterEach(async () => {
    jest.useRealTimers();
    if (queue) {
      await queue.stop();
      queue = undefined;
    }
  });

  describe("Basic cron execution", () => {
    it("should execute cron job at correct wall-clock time", async () => {
      queue = createTestQueue("test-cron-execute");

      let executionCount = 0;
      await queue.consume(
        async () => {
          executionCount++;
        },
        { consumerGroup: "test", maxRetries: 0 },
      );

      // Schedule to run every minute at second 0
      await queue.scheduleRecurring("payload", {
        jobId: "cron-every-minute",
        cronPattern: "* * * * *",
      });

      // Advance time by 61 seconds to trigger cron at 10:01:00
      jest.advanceTimersByTime(61_000);
      await Promise.resolve(); // Allow microtasks to flush

      expect(executionCount).toBeGreaterThanOrEqual(1);
    });

    it("should reschedule cron job after execution", async () => {
      queue = createTestQueue("test-cron-reschedule");

      let executionCount = 0;
      await queue.consume(
        async () => {
          executionCount++;
        },
        { consumerGroup: "test", maxRetries: 0 },
      );

      await queue.scheduleRecurring("payload", {
        jobId: "cron-reschedule",
        cronPattern: "* * * * *",
      });

      // Advance 2 minutes to trigger two executions
      jest.advanceTimersByTime(60_000);
      await Promise.resolve();

      jest.advanceTimersByTime(60_000);
      await Promise.resolve();

      expect(executionCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Cron cancellation", () => {
    it("should cancel pending cron jobs on stop()", async () => {
      queue = createTestQueue("test-cron-stop");

      let executionCount = 0;
      await queue.consume(
        async () => {
          executionCount++;
        },
        { consumerGroup: "test", maxRetries: 0 },
      );

      await queue.scheduleRecurring("payload", {
        jobId: "cron-stop-test",
        cronPattern: "* * * * *",
      });

      // Stop the queue before cron fires
      await queue.stop();
      queue = undefined;

      // Advance time past when cron should have fired
      jest.advanceTimersByTime(120_000);
      await Promise.resolve();

      // Should NOT have executed any jobs since queue was stopped
      expect(executionCount).toBe(0);
    });

    it("should stop cron scheduling when cancelled", async () => {
      queue = createTestQueue("test-cron-cancel");

      let executionCount = 0;
      await queue.consume(
        async () => {
          executionCount++;
        },
        { consumerGroup: "test", maxRetries: 0 },
      );

      await queue.scheduleRecurring("payload", {
        jobId: "cron-cancel-test",
        cronPattern: "* * * * *",
      });

      // Execute once
      jest.advanceTimersByTime(60_000);
      await Promise.resolve();
      const countBeforeCancel = executionCount;

      // Cancel the job
      await queue.cancelRecurring("cron-cancel-test");

      // Advance time - should NOT execute
      jest.advanceTimersByTime(60_000);
      await Promise.resolve();

      expect(executionCount).toBe(countBeforeCancel);
    });
  });

  describe("Cron job details", () => {
    it("should return cronPattern in getRecurringJobDetails", async () => {
      queue = createTestQueue("test-cron-details");

      await queue.scheduleRecurring("payload", {
        jobId: "cron-details-test",
        cronPattern: "0 9 * * 1-5",
      });

      const details = await queue.getRecurringJobDetails("cron-details-test");

      expect(details).toBeDefined();
      expect(details?.jobId).toBe("cron-details-test");
      expect("cronPattern" in details!).toBe(true);
      if ("cronPattern" in details!) {
        expect(details.cronPattern).toBe("0 9 * * 1-5");
      }
    });

    it("should return intervalSeconds for interval-based jobs", async () => {
      queue = createTestQueue("test-interval-details");

      await queue.scheduleRecurring("payload", {
        jobId: "interval-details-test",
        intervalSeconds: 60,
      });

      const details = await queue.getRecurringJobDetails(
        "interval-details-test",
      );

      expect(details).toBeDefined();
      expect(details?.jobId).toBe("interval-details-test");
      expect("intervalSeconds" in details!).toBe(true);
      if ("intervalSeconds" in details!) {
        expect(details.intervalSeconds).toBe(60);
      }
    });
  });

  describe("MAX_TIMEOUT handling", () => {
    it("should handle long delays by chunking timeouts", async () => {
      queue = createTestQueue("test-max-timeout");

      let executionCount = 0;
      await queue.consume(
        async () => {
          executionCount++;
        },
        { consumerGroup: "test", maxRetries: 0 },
      );

      // Schedule monthly cron (1st of each month at midnight)
      // Starting from Jan 18, next run is Feb 1 = ~14 days
      await queue.scheduleRecurring("payload", {
        jobId: "monthly-cron",
        cronPattern: "0 0 1 * *",
      });

      // Advance 10 days - should not have executed yet
      jest.advanceTimersByTime(10 * 24 * 60 * 60 * 1000);
      await Promise.resolve();
      expect(executionCount).toBe(0);

      // Advance 5 more days to pass Feb 1 (total 15 days)
      jest.advanceTimersByTime(5 * 24 * 60 * 60 * 1000);
      await Promise.resolve();

      // Now it should have executed on Feb 1
      expect(executionCount).toBeGreaterThanOrEqual(1);
    });

    it("should chunk timeouts longer than MAX_TIMEOUT", async () => {
      queue = createTestQueue("test-max-timeout-chunk");

      let executionCount = 0;
      await queue.consume(
        async () => {
          executionCount++;
        },
        { consumerGroup: "test", maxRetries: 0 },
      );

      // Schedule cron for ~30 days from now (past MAX_TIMEOUT of ~24.8 days)
      // Feb 18 at midnight = 31 days from Jan 18
      await queue.scheduleRecurring("payload", {
        jobId: "far-cron",
        cronPattern: "0 0 18 2 *",
      });

      // Advance 25 days (past MAX_TIMEOUT) - requires chunking internally
      jest.advanceTimersByTime(25 * 24 * 60 * 60 * 1000);
      await Promise.resolve();
      expect(executionCount).toBe(0); // Feb 12 - still not Feb 18

      // Advance 7 more days to Feb 18
      jest.advanceTimersByTime(7 * 24 * 60 * 60 * 1000);
      await Promise.resolve();

      expect(executionCount).toBeGreaterThanOrEqual(1);
    }, 10_000);
  });

  describe("Invalid cron patterns", () => {
    it("should log error for invalid cron pattern", async () => {
      queue = createTestQueue("test-invalid-cron");

      await queue.scheduleRecurring("payload", {
        jobId: "invalid-cron",
        cronPattern: "invalid-pattern",
      });

      // The error should be logged immediately during scheduleNextCronRun
      expect(mockError).toHaveBeenCalled();
    });
  });
});
