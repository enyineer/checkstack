import type { Queue, QueueFactory, QueueJob } from "@checkmate/queue-api";

/**
 * Creates a mock QueueFactory for testing.
 * This factory creates simple in-memory mock queues for testing purposes.
 *
 * @returns A mock QueueFactory
 *
 * @example
 * ```typescript
 * const mockQueueFactory = createMockQueueFactory();
 * const queue = mockQueueFactory.createQueue("test-channel");
 * ```
 */
export function createMockQueueFactory(): QueueFactory {
  const queues = new Map<string, Queue<unknown>>();

  return {
    createQueue: (channelId: string) => {
      // Return existing queue if already created
      if (queues.has(channelId)) {
        return queues.get(channelId)!;
      }

      const consumers = new Map<
        string,
        {
          handler: (job: QueueJob<unknown>) => Promise<void>;
          maxRetries: number;
        }
      >();
      const jobs: unknown[] = [];

      const mockQueue: Queue<unknown> = {
        enqueue: async (data: unknown) => {
          jobs.push(data);
          // Trigger all consumers (with error handling like real queue)
          for (const [_group, consumer] of consumers.entries()) {
            try {
              await consumer.handler({
                id: `job-${Date.now()}`,
                data,
                timestamp: new Date(),
                attempts: 0,
              });
            } catch (error) {
              // Mock queue catches errors like real implementation
              console.error("Mock queue caught error:", error);
            }
          }
          return `job-${Date.now()}`;
        },
        consume: async (handler, options) => {
          consumers.set(options.consumerGroup, {
            handler: async (job: QueueJob<unknown>) => await handler(job),
            maxRetries: options.maxRetries ?? 3,
          });
        },
        scheduleRecurring: async (data: unknown, options) => {
          // Simple mock - just enqueue once for testing
          // Real implementation would handle recurring execution
          jobs.push(data);
          return options.jobId;
        },
        cancelRecurring: async (_jobId: string) => {
          // Mock implementation - no-op
        },
        listRecurringJobs: async () => {
          return [];
        },
        testConnection: async () => {
          // Mock implementation - always succeeds
        },
        stop: async () => {
          consumers.clear();
        },
        getStats: async () => ({
          pending: jobs.length,
          processing: 0,
          completed: 0,
          failed: 0,
          consumerGroups: consumers.size,
        }),
      };

      queues.set(channelId, mockQueue);
      return mockQueue;
    },
  } as QueueFactory;
}
