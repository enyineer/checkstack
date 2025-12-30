import { describe, it, expect, beforeEach } from "bun:test";
import { InMemoryQueue } from "./memory-queue";
import type { QueueJob } from "@checkmate/queue-api";

describe("InMemoryQueue Consumer Groups", () => {
  let queue: InMemoryQueue<string>;

  beforeEach(() => {
    queue = new InMemoryQueue("test-queue", {
      concurrency: 10,
      maxQueueSize: 100,
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
    it(
      "should retry failed jobs with exponential backoff",
      async () => {
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

        // Wait for retries (2^1=2s, 2^2=4s, so total ~7s + buffer)
        await new Promise((resolve) => setTimeout(resolve, 8000));

        // Should have tried 3 times (initial + 2 retries)
        expect(attempts).toBe(3);

        // Check exponential backoff (delays should increase)
        if (attemptTimestamps.length >= 3) {
          const delay1 = attemptTimestamps[1] - attemptTimestamps[0];
          const delay2 = attemptTimestamps[2] - attemptTimestamps[1];

          // First retry after 2^1 = 2 seconds (allow more tolerance for suite execution)
          expect(delay1).toBeGreaterThanOrEqual(1800); // Allow 200ms tolerance
          expect(delay1).toBeLessThanOrEqual(2500);

          // Second retry after 2^2 = 4 seconds
          expect(delay2).toBeGreaterThanOrEqual(3800);
          expect(delay2).toBeLessThanOrEqual(4500);

          // Verify exponential growth (delay2 should be roughly 2x delay1)
          expect(delay2).toBeGreaterThan(delay1);
        }
      },
      { timeout: 10000 } // Increase timeout for this test
    );

    it(
      "should not retry beyond maxRetries",
      async () => {
        let attempts = 0;

        await queue.consume(
          async () => {
            attempts++;
            throw new Error("Always fails");
          },
          { consumerGroup: "fail-group", maxRetries: 2 }
        );

        await queue.enqueue("test");

        // Wait for all retries (2^1=2s, 2^2=4s, so ~7s total)
        await new Promise((resolve) => setTimeout(resolve, 8000));

        // Should try 3 times total (initial + 2 retries)
        expect(attempts).toBe(3);
      },
      { timeout: 10000 } // Increase timeout for this test
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
});
