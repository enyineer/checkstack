import { describe, it, expect, beforeEach } from "bun:test";
import { InMemoryQueue } from "./memory-queue";
import type { QueueJob } from "@checkstack/queue-api";

describe("InMemoryQueue Consumer Groups", () => {
  let queue: InMemoryQueue<string>;

  beforeEach(() => {
    queue = new InMemoryQueue("test-queue", {
      concurrency: 10,
      maxQueueSize: 100,
      delayMultiplier: 0.01, // 100x faster delays for testing
    });
  });

  describe("Broadcast Pattern (Unique Consumer Groups)", () => {
    it("should deliver message to all consumers with different groups", async () => {
      const received: string[] = [];

      // Register two consumers with different groups
      await queue.consume(
        async (job) => {
          received.push(`consumer-1:${job.data}`);
        },
        { consumerGroup: "group-1", maxRetries: 0 }
      );

      await queue.consume(
        async (job) => {
          received.push(`consumer-2:${job.data}`);
        },
        { consumerGroup: "group-2", maxRetries: 0 }
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
        { consumerGroup: "group-1", maxRetries: 0 }
      );

      await queue.consume(
        async (job) => {
          received["group-2"].push(job.data);
        },
        { consumerGroup: "group-2", maxRetries: 0 }
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
        { consumerGroup: "shared-group", maxRetries: 0 }
      );

      await queue.consume(
        async (job) => {
          received["consumer-2"].push(job.data);
        },
        { consumerGroup: "shared-group", maxRetries: 0 }
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
        { consumerGroup: "work-group", maxRetries: 0 }
      );

      await queue.consume(
        async () => {
          consumer2Count++;
        },
        { consumerGroup: "work-group", maxRetries: 0 }
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
        { consumerGroup: "retry-group", maxRetries: 3 }
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

    it("should not retry beyond maxRetries", async () => {
      let attempts = 0;

      await queue.consume(
        async () => {
          attempts++;
          throw new Error("Always fails");
        },
        { consumerGroup: "fail-group", maxRetries: 2 }
      );

      await queue.enqueue("test");

      // Wait for all retries (with delayMultiplier=0.01: ~60ms total)
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should try 3 times total (initial + 2 retries)
      expect(attempts).toBe(3);
    });
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
        { consumerGroup: "broadcast-1", maxRetries: 0 }
      );

      await queue.consume(
        async (job) => {
          broadcastReceived.push(`broadcast-2:${job.data}`);
        },
        { consumerGroup: "broadcast-2", maxRetries: 0 }
      );

      // Work-queue consumers (same group)
      await queue.consume(
        async (job) => {
          workQueueReceived.push(`work-1:${job.data}`);
        },
        { consumerGroup: "work-group", maxRetries: 0 }
      );

      await queue.consume(
        async (job) => {
          workQueueReceived.push(`work-2:${job.data}`);
        },
        { consumerGroup: "work-group", maxRetries: 0 }
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
          workQueueReceived[0] === "work-2:test-msg"
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
        { consumerGroup: "stats-group", maxRetries: 0 }
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
      const processedTimes: number[] = [];
      const enqueueTime = Date.now();

      await queue.consume(
        async (job) => {
          processedTimes.push(Date.now());
        },
        { consumerGroup: "delay-group", maxRetries: 0 }
      );

      // Enqueue with 2-second delay (becomes 20ms with delayMultiplier=0.01)
      await queue.enqueue("delayed-job", { startDelay: 2 });

      // Check immediately - should not be processed yet
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(processedTimes.length).toBe(0);

      // Wait for delay to expire (20ms + generous buffer for CI)
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(processedTimes.length).toBe(1);

      // Verify it was processed after the delay
      const actualDelay = processedTimes[0] - enqueueTime;
      expect(actualDelay).toBeGreaterThanOrEqual(15); // Allow tolerance
      expect(actualDelay).toBeLessThanOrEqual(200); // Allow more tolerance for CI
    });

    it("should process non-delayed jobs immediately while delayed jobs wait", async () => {
      const processed: string[] = [];

      await queue.consume(
        async (job) => {
          processed.push(job.data);
        },
        { consumerGroup: "mixed-delay-group", maxRetries: 0 }
      );

      // Enqueue delayed job first (10s delay = 100ms with multiplier)
      await queue.enqueue("delayed", { startDelay: 10 });

      // Enqueue immediate job
      await queue.enqueue("immediate");

      // Wait for immediate job to be processed (should be done quickly)
      // The delayed job should NOT be processed yet (100ms delay)
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(processed).toEqual(["immediate"]);

      // Wait for delayed job (100ms + generous buffer for CI)
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(processed).toEqual(["immediate", "delayed"]);
    });

    it("should respect priority with delayed jobs", async () => {
      const processed: string[] = [];

      await queue.consume(
        async (job) => {
          processed.push(job.data);
        },
        { consumerGroup: "priority-delay-group", maxRetries: 0 }
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

      // Wait for delay to expire (10ms + buffer)
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should process in priority order (highest first)
      expect(processed).toEqual([
        "high-priority",
        "medium-priority",
        "low-priority",
      ]);
    });
  });

  describe("Job Deduplication", () => {
    it("should skip duplicate jobs with same jobId", async () => {
      const processed: string[] = [];

      await queue.consume(
        async (job) => {
          processed.push(job.data);
        },
        { consumerGroup: "dedup-group", maxRetries: 0 }
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
        { consumerGroup: "different-group", maxRetries: 0 }
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
});
