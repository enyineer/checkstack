import { describe, it, expect, beforeEach, afterEach, jest } from "bun:test";
import { InMemoryQueue } from "./memory-queue";
import type { QueueJob } from "@checkstack/queue-api";
import type { Logger } from "@checkstack/backend-api";

// Suppress console.error output during tests for failed jobs
const testLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("InMemoryQueue Consumer Groups", () => {
  let queue: InMemoryQueue<string>;

  beforeEach(() => {
    queue = new InMemoryQueue(
      "test-queue",
      {
        concurrency: 10,
        maxQueueSize: 100,
        delayMultiplier: 0.01, // 100x faster delays for testing
        heartbeatIntervalMs: 0, // Disable heartbeat during tests
      },
      testLogger,
    );
  });

  afterEach(async () => {
    await queue.stop();
  });

  describe("Broadcast Pattern (Unique Consumer Groups)", () => {
    it("should deliver message to all consumers with different groups", async () => {
      const received: string[] = [];

      // Register two consumers with different groups
      await queue.consume(
        async (job) => {
          received.push(`consumer-1:${job.data}`);
        },
        { consumerGroup: "group-1", maxRetries: 0 },
      );

      await queue.consume(
        async (job) => {
          received.push(`consumer-2:${job.data}`);
        },
        { consumerGroup: "group-2", maxRetries: 0 },
      );

      // Enqueue a message
      await queue.enqueue("test-message");

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Both consumers should receive the message
      expect(received).toContain("consumer-1:test-message");
      expect(received).toContain("consumer-2:test-message");
      expect(received.length).toBe(2);
    });

    it("should deliver multiple messages to all consumer groups", async () => {
      const received: Record<string, string[]> = {
        "group-1": [],
        "group-2": [],
      };

      await queue.consume(
        async (job) => {
          received["group-1"].push(job.data);
        },
        { consumerGroup: "group-1", maxRetries: 0 },
      );

      await queue.consume(
        async (job) => {
          received["group-2"].push(job.data);
        },
        { consumerGroup: "group-2", maxRetries: 0 },
      );

      // Enqueue multiple messages
      await queue.enqueue("msg-1");
      await queue.enqueue("msg-2");
      await queue.enqueue("msg-3");

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Both groups should receive all messages
      expect(received["group-1"]).toEqual(["msg-1", "msg-2", "msg-3"]);
      expect(received["group-2"]).toEqual(["msg-1", "msg-2", "msg-3"]);
    });
  });

  describe("Work-Queue Pattern (Same Consumer Group)", () => {
    it("should distribute messages round-robin within same group", async () => {
      const received: Record<string, string[]> = {
        "consumer-1": [],
        "consumer-2": [],
      };

      // Two consumers in the same group
      await queue.consume(
        async (job) => {
          received["consumer-1"].push(job.data);
        },
        { consumerGroup: "shared-group", maxRetries: 0 },
      );

      await queue.consume(
        async (job) => {
          received["consumer-2"].push(job.data);
        },
        { consumerGroup: "shared-group", maxRetries: 0 },
      );

      // Enqueue multiple messages
      await queue.enqueue("msg-1");
      await queue.enqueue("msg-2");
      await queue.enqueue("msg-3");
      await queue.enqueue("msg-4");

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Messages should be distributed (round-robin)
      const total =
        received["consumer-1"].length + received["consumer-2"].length;
      expect(total).toBe(4);

      // Each consumer should get some messages (round-robin)
      expect(received["consumer-1"].length).toBeGreaterThan(0);
      expect(received["consumer-2"].length).toBeGreaterThan(0);

      // All messages should be received exactly once across consumers
      const allReceived = [
        ...received["consumer-1"],
        ...received["consumer-2"],
      ].sort();
      expect(allReceived).toEqual(["msg-1", "msg-2", "msg-3", "msg-4"]);
    });

    it("should only deliver to one consumer in the group", async () => {
      let consumer1Count = 0;
      let consumer2Count = 0;

      await queue.consume(
        async () => {
          consumer1Count++;
        },
        { consumerGroup: "work-group", maxRetries: 0 },
      );

      await queue.consume(
        async () => {
          consumer2Count++;
        },
        { consumerGroup: "work-group", maxRetries: 0 },
      );

      // Single message
      await queue.enqueue("test");

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Only one consumer should process it
      expect(consumer1Count + consumer2Count).toBe(1);
    });
  });

  describe("Retry Logic", () => {
    it("should retry failed jobs with exponential backoff", async () => {
      let attempts = 0;
      const attemptTimestamps: number[] = [];

      await queue.consume(
        async (job) => {
          attemptTimestamps.push(Date.now());
          attempts++;
          if (attempts < 3) {
            throw new Error("Simulated failure");
          }
        },
        { consumerGroup: "retry-group", maxRetries: 3 },
      );

      await queue.enqueue("test");

      // Wait for retries (with delayMultiplier=0.01: 20ms + 40ms = 60ms + buffer)
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should have tried 3 times (initial + 2 retries)
      expect(attempts).toBe(3);

      // Check exponential backoff (delays should increase)
      if (attemptTimestamps.length >= 3) {
        const delay1 = attemptTimestamps[1] - attemptTimestamps[0];
        const delay2 = attemptTimestamps[2] - attemptTimestamps[1];

        // With delayMultiplier=0.01: first retry after 2^1 * 1000 * 0.01 = 20ms
        expect(delay1).toBeGreaterThanOrEqual(15); // Allow tolerance
        expect(delay1).toBeLessThanOrEqual(50);

        // Second retry after 2^2 * 1000 * 0.01 = 40ms
        expect(delay2).toBeGreaterThanOrEqual(35);
        expect(delay2).toBeLessThanOrEqual(80);

        // Verify exponential growth (delay2 should be roughly 2x delay1)
        expect(delay2).toBeGreaterThan(delay1);
      }
    });

    it(
      "should not retry beyond maxRetries",
      async () => {
        let attempts = 0;

        await queue.consume(
          async () => {
            attempts++;
            throw new Error("Always fails");
          },
          { consumerGroup: "fail-group", maxRetries: 2 },
        );

        await queue.enqueue("test");

        // Poll instead of a fixed sleep: the retries take ~60ms nominally
        // (delayMultiplier=0.01), but under full-suite load the event loop
        // can starve the retry timers well past that.
        const deadline = Date.now() + 5000;
        while (attempts < 3 && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }

        // Should try 3 times total (initial + 2 retries)...
        expect(attempts).toBe(3);

        // ...and never a 4th: give a would-be extra retry ample time to fire.
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(attempts).toBe(3);
      },
      10_000,
    );
  });

  describe("Mixed Patterns", () => {
    it("should handle both broadcast and work-queue simultaneously", async () => {
      const broadcastReceived: string[] = [];
      const workQueueReceived: string[] = [];

      // Broadcast consumers (different groups)
      await queue.consume(
        async (job) => {
          broadcastReceived.push(`broadcast-1:${job.data}`);
        },
        { consumerGroup: "broadcast-1", maxRetries: 0 },
      );

      await queue.consume(
        async (job) => {
          broadcastReceived.push(`broadcast-2:${job.data}`);
        },
        { consumerGroup: "broadcast-2", maxRetries: 0 },
      );

      // Work-queue consumers (same group)
      await queue.consume(
        async (job) => {
          workQueueReceived.push(`work-1:${job.data}`);
        },
        { consumerGroup: "work-group", maxRetries: 0 },
      );

      await queue.consume(
        async (job) => {
          workQueueReceived.push(`work-2:${job.data}`);
        },
        { consumerGroup: "work-group", maxRetries: 0 },
      );

      await queue.enqueue("test-msg");

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Both broadcast consumers should receive
      expect(broadcastReceived.length).toBe(2);
      expect(broadcastReceived).toContain("broadcast-1:test-msg");
      expect(broadcastReceived).toContain("broadcast-2:test-msg");

      // Only one work-queue consumer should receive
      expect(workQueueReceived.length).toBe(1);
      expect(
        workQueueReceived[0] === "work-1:test-msg" ||
          workQueueReceived[0] === "work-2:test-msg",
      ).toBe(true);
    });
  });

  describe("Queue Stats", () => {
    it("should track consumer group count", async () => {
      await queue.consume(async () => {}, {
        consumerGroup: "group-1",
        maxRetries: 0,
      });
      await queue.consume(async () => {}, {
        consumerGroup: "group-2",
        maxRetries: 0,
      });
      await queue.consume(async () => {}, {
        consumerGroup: "group-3",
        maxRetries: 0,
      });

      const stats = await queue.getStats();
      expect(stats.consumerGroups).toBe(3);
    });

    it("should track pending, processing, completed, and failed", async () => {
      let processedCount = 0;

      await queue.consume(
        async () => {
          processedCount++;
          if (processedCount === 2) {
            throw new Error("Fail second job");
          }
          // Simulate some processing time
          await new Promise((resolve) => setTimeout(resolve, 50));
        },
        { consumerGroup: "stats-group", maxRetries: 0 },
      );

      await queue.enqueue("msg-1");
      await queue.enqueue("msg-2");
      await queue.enqueue("msg-3");

      // Check stats during processing
      await new Promise((resolve) => setTimeout(resolve, 25));
      let stats = await queue.getStats();
      expect(stats.processing).toBeGreaterThanOrEqual(0);

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 200));
      stats = await queue.getStats();

      expect(stats.completed).toBe(2); // msg-1 and msg-3
      expect(stats.failed).toBe(1); // msg-2
      expect(stats.pending).toBe(0);
    });
  });

  describe("Delayed Jobs", () => {
    it("should not process job until delay expires", async () => {
      // Use fake timers for deterministic behavior
      jest.useFakeTimers();

      let processed = false;

      await queue.consume(
        async () => {
          processed = true;
        },
        { consumerGroup: "delay-group", maxRetries: 0 },
      );

      // Enqueue with 2-second delay (becomes 20ms with delayMultiplier=0.01)
      await queue.enqueue("delayed-job", { startDelay: 2 });

      // Advance time but NOT past the delay (20ms)
      jest.advanceTimersByTime(15);
      await Promise.resolve();
      expect(processed).toBe(false);

      // Advance past the delay
      jest.advanceTimersByTime(10);
      await Promise.resolve();
      expect(processed).toBe(true);

      jest.useRealTimers();
    });

    it("should process non-delayed jobs immediately while delayed jobs wait", async () => {
      // Use fake timers to make this test completely deterministic
      jest.useFakeTimers();

      const processed: string[] = [];

      await queue.consume(
        async (job) => {
          processed.push(job.data);
        },
        { consumerGroup: "mixed-delay-group", maxRetries: 0 },
      );

      // Enqueue delayed job first (10s delay = 100ms with 0.01 multiplier)
      await queue.enqueue("delayed", { startDelay: 10 });

      // Enqueue immediate job
      await queue.enqueue("immediate");

      // Advance timers just enough for immediate job to process, but NOT the delayed job
      jest.advanceTimersByTime(10);
      // Flush the promise queue to let the async handler complete
      await Promise.resolve();

      expect(processed).toEqual(["immediate"]);

      // Advance past the delay (100ms total needed)
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      expect(processed).toEqual(["immediate", "delayed"]);

      // Restore real timers
      jest.useRealTimers();
    });

    it("should respect priority with delayed jobs", async () => {
      // Use fake timers for deterministic behavior
      jest.useFakeTimers();

      const processed: string[] = [];

      await queue.consume(
        async (job) => {
          processed.push(job.data);
        },
        { consumerGroup: "priority-delay-group", maxRetries: 0 },
      );

      // Enqueue multiple delayed jobs with same delay but different priorities
      // (1s delay = 10ms with multiplier)
      await queue.enqueue("low-priority", {
        startDelay: 1,
        priority: 1,
      });
      await queue.enqueue("high-priority", {
        startDelay: 1,
        priority: 10,
      });
      await queue.enqueue("medium-priority", {
        startDelay: 1,
        priority: 5,
      });

      // Advance past the delay (10ms)
      jest.advanceTimersByTime(15);
      await Promise.resolve();

      // Should process in priority order (highest first)
      expect(processed).toEqual([
        "high-priority",
        "medium-priority",
        "low-priority",
      ]);

      jest.useRealTimers();
    });
  });

  describe("Job Deduplication", () => {
    it("should skip duplicate jobs with same jobId", async () => {
      const processed: string[] = [];

      await queue.consume(
        async (job) => {
          processed.push(job.data);
        },
        { consumerGroup: "dedup-group", maxRetries: 0 },
      );

      // Enqueue job with custom jobId
      const jobId1 = await queue.enqueue("first", { jobId: "unique-job-1" });
      expect(jobId1).toBe("unique-job-1");

      // Try to enqueue duplicate (should return same jobId without adding to queue)
      const jobId2 = await queue.enqueue("duplicate", {
        jobId: "unique-job-1",
      });
      expect(jobId2).toBe("unique-job-1");

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should only have processed the first job
      expect(processed.length).toBe(1);
      expect(processed[0]).toBe("first");
    });

    it("should allow different jobIds", async () => {
      const processed: string[] = [];

      await queue.consume(
        async (job) => {
          processed.push(job.data);
        },
        { consumerGroup: "different-group", maxRetries: 0 },
      );

      await queue.enqueue("job1", { jobId: "job-1" });
      await queue.enqueue("job2", { jobId: "job-2" });
      await queue.enqueue("job3", { jobId: "job-3" });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(processed.length).toBe(3);
      expect(processed).toContain("job1");
      expect(processed).toContain("job2");
      expect(processed).toContain("job3");
    });
  });

  // NOTE: Recurring job tests are in recurring-jobs.test.ts

  describe("listJobs + getStats scope", () => {
    it("getStats reports scope=instance", async () => {
      const stats = await queue.getStats();
      expect(stats.scope).toBe("instance");
    });

    it("lists waiting jobs in FIFO order", async () => {
      await queue.enqueue("a", { jobId: "j-a" });
      await queue.enqueue("b", { jobId: "j-b" });
      await queue.enqueue("c", { jobId: "j-c" });

      const waiting = await queue.listJobs({
        state: "waiting",
        offset: 0,
        limit: 10,
      });
      expect(waiting.items.map((j) => j.id)).toEqual(["j-a", "j-b", "j-c"]);
      expect(waiting.items.every((j) => j.state === "waiting")).toBe(true);
      expect(waiting.total).toBe(3);
      expect(waiting.hasMore).toBe(false);
    });

    it("classifies delayed jobs separately from waiting", async () => {
      // delayMultiplier=0.01 means startDelay=10s becomes 100ms; list before it elapses.
      await queue.enqueue("now");
      await queue.enqueue("later", { startDelay: 10 });

      const waiting = await queue.listJobs({
        state: "waiting",
        offset: 0,
        limit: 10,
      });
      const delayed = await queue.listJobs({
        state: "delayed",
        offset: 0,
        limit: 10,
      });
      expect(waiting.items).toHaveLength(1);
      expect(delayed.items).toHaveLength(1);
    });

    it("surfaces recurring (cron) schedules under pending with nextRunAt", async () => {
      // Use cron pattern: every minute
      await queue.scheduleRecurring("payload", {
        jobId: "cron-job",
        cronPattern: "*/1 * * * *",
      });

      const pending = await queue.listJobs({
        state: "pending",
        offset: 0,
        limit: 10,
      });
      const cronRow = pending.items.find((j) => j.id === "cron-job");
      expect(cronRow).toBeDefined();
      expect(cronRow!.recurring).toBe(true);
      expect(cronRow!.state).toBe("delayed");
      expect(cronRow!.nextRunAt).toBeInstanceOf(Date);
      expect(cronRow!.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    });

    it("surfaces recurring (interval) schedules under delayed with nextRunAt", async () => {
      await queue.scheduleRecurring("payload", {
        jobId: "interval-job",
        intervalSeconds: 60,
      });

      const delayed = await queue.listJobs({
        state: "delayed",
        offset: 0,
        limit: 10,
      });
      const row = delayed.items.find((j) => j.id === "interval-job");
      expect(row).toBeDefined();
      expect(row!.recurring).toBe(true);
      expect(row!.nextRunAt).toBeInstanceOf(Date);
    });

    it("'pending' is the union of waiting and delayed, FIFO", async () => {
      await queue.enqueue("now1", { jobId: "p-now-1" });
      await queue.enqueue("later", { jobId: "p-later", startDelay: 10 });
      await queue.enqueue("now2", { jobId: "p-now-2" });

      const pending = await queue.listJobs({
        state: "pending",
        offset: 0,
        limit: 10,
      });
      expect(pending.items.map((j) => j.id)).toEqual([
        "p-now-1",
        "p-later",
        "p-now-2",
      ]);
      expect(pending.total).toBe(3);
      // Per-job state classification preserved.
      const states = Object.fromEntries(
        pending.items.map((j) => [j.id, j.state]),
      );
      expect(states["p-now-1"]).toBe("waiting");
      expect(states["p-later"]).toBe("delayed");
      expect(states["p-now-2"]).toBe("waiting");
    });

    it("records completed jobs in history (most-recent first)", async () => {
      await queue.consume(async () => {}, {
        consumerGroup: "g1",
        maxRetries: 0,
      });

      await queue.enqueue("x", { jobId: "ok-1" });
      await queue.enqueue("y", { jobId: "ok-2" });
      await new Promise((resolve) => setTimeout(resolve, 60));

      const completed = await queue.listJobs({
        state: "completed",
        offset: 0,
        limit: 10,
      });
      expect(completed.items.length).toBe(2);
      expect(completed.total).toBe(2);
      // Newest first
      expect(
        completed.items[0].finishedAt!.getTime(),
      ).toBeGreaterThanOrEqual(completed.items[1].finishedAt!.getTime());
      expect(completed.items[0].state).toBe("completed");
    });

    it("records failed jobs with the error message", async () => {
      await queue.consume(
        async () => {
          throw new Error("boom");
        },
        { consumerGroup: "g1", maxRetries: 0 },
      );

      await queue.enqueue("z", { jobId: "bad-1" });
      await new Promise((resolve) => setTimeout(resolve, 60));

      const failed = await queue.listJobs({
        state: "failed",
        offset: 0,
        limit: 10,
      });
      expect(failed.items.length).toBe(1);
      expect(failed.items[0].state).toBe("failed");
      expect(failed.items[0].failedReason).toBe("boom");
    });

    it("paginates with offset/limit", async () => {
      await queue.consume(async () => {}, {
        consumerGroup: "g1",
        maxRetries: 0,
      });
      for (let i = 0; i < 10; i++) {
        await queue.enqueue("v", { jobId: `id-${i}` });
      }
      await new Promise((resolve) => setTimeout(resolve, 80));

      const page1 = await queue.listJobs({
        state: "completed",
        offset: 0,
        limit: 3,
      });
      expect(page1.items).toHaveLength(3);
      expect(page1.total).toBe(10);
      expect(page1.hasMore).toBe(true);

      const page2 = await queue.listJobs({
        state: "completed",
        offset: 3,
        limit: 3,
      });
      expect(page2.items).toHaveLength(3);
      // Different page should yield different ids
      expect(page2.items.map((j) => j.id)).not.toEqual(
        page1.items.map((j) => j.id),
      );

      const lastPage = await queue.listJobs({
        state: "completed",
        offset: 9,
        limit: 3,
      });
      expect(lastPage.items).toHaveLength(1);
      expect(lastPage.hasMore).toBe(false);
    });
  });

  describe("backlog accounting under saturation", () => {
    it("counts jobs waiting for a concurrency slot as pending (not lost)", async () => {
      const q = new InMemoryQueue<string>(
        "saturation",
        {
          concurrency: 1,
          maxQueueSize: 100,
          delayMultiplier: 1,
          heartbeatIntervalMs: 0,
        },
        testLogger,
      );

      // A gate that keeps the single slot occupied until we release it, so we
      // can observe jobs queued behind it.
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      await q.consume(
        async () => {
          await gate;
        },
        { consumerGroup: "g", maxRetries: 0 },
      );

      // Three jobs against a single slot: one runs, two wait for the slot.
      await q.enqueue("a");
      await q.enqueue("b");
      await q.enqueue("c");

      // Let processNext/processJob run to the point where the two extra jobs are
      // blocked on semaphore.acquire().
      for (let i = 0; i < 30; i++) await Promise.resolve();

      const stats = await q.getStats();
      expect(stats.processing).toBe(1);
      // The two slot-waiters MUST show as pending. Before the fix they were
      // removed from `jobs` before acquiring a slot, so this read 0 - hiding the
      // real backlog exactly when saturation makes it matter.
      expect(stats.pending).toBe(2);

      // Releasing the slot drains everything.
      release();
      for (let i = 0; i < 60; i++) await Promise.resolve();
      const drained = await q.getStats();
      expect(drained.pending).toBe(0);

      await q.stop();
    });
  });
});
