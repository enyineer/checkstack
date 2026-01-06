import type {
  Queue,
  QueueManager,
  QueueJob,
  SwitchResult,
  RecurringJobInfo,
  RecurringJobDetails,
} from "@checkmate-monitor/queue-api";

/**
 * Creates a mock QueueManager for testing.
 * This manager creates simple in-memory mock queues for testing purposes.
 *
 * @returns A mock QueueManager
 *
 * @example
 * ```typescript
 * const mockQueueManager = createMockQueueManager();
 * const queue = mockQueueManager.getQueue("test-channel");
 * ```
 */
export function createMockQueueManager(): QueueManager {
  const queues = new Map<string, Queue<unknown>>();
  let activePluginId = "mock";

  function createMockQueue<T>(_channelId: string): Queue<T> {
    const consumers = new Map<
      string,
      {
        handler: (job: QueueJob<T>) => Promise<void>;
        maxRetries: number;
      }
    >();
    const jobs: T[] = [];
    const recurringJobs = new Map<
      string,
      { data: T; intervalSeconds: number }
    >();

    const mockQueue: Queue<T> = {
      enqueue: async (data) => {
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
          handler: async (job: QueueJob<T>) => await handler(job),
          maxRetries: options.maxRetries ?? 3,
        });
      },
      scheduleRecurring: async (data, options) => {
        recurringJobs.set(options.jobId, {
          data,
          intervalSeconds: options.intervalSeconds,
        });
        return options.jobId;
      },
      cancelRecurring: async (jobId) => {
        recurringJobs.delete(jobId);
      },
      listRecurringJobs: async () => {
        return [...recurringJobs.keys()];
      },
      getRecurringJobDetails: async (
        jobId
      ): Promise<RecurringJobDetails<T> | undefined> => {
        const job = recurringJobs.get(jobId);
        if (!job) return undefined;
        return {
          jobId,
          data: job.data,
          intervalSeconds: job.intervalSeconds,
        };
      },
      getInFlightCount: async () => 0,
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

    return mockQueue;
  }

  return {
    getQueue: <T>(name: string): Queue<T> => {
      // Return existing queue if already created
      if (queues.has(name)) {
        return queues.get(name)! as Queue<T>;
      }

      const mockQueue = createMockQueue<T>(name);
      queues.set(name, mockQueue as Queue<unknown>);
      return mockQueue;
    },
    getActivePlugin: () => activePluginId,
    getActiveConfig: () => ({}),
    setActiveBackend: async (pluginId: string): Promise<SwitchResult> => {
      activePluginId = pluginId;
      return { success: true, migratedRecurringJobs: 0, warnings: [] };
    },
    getInFlightJobCount: async () => 0,
    listAllRecurringJobs: async (): Promise<RecurringJobInfo[]> => [],
    startPolling: () => {},
    shutdown: async () => {
      for (const queue of queues.values()) {
        await queue.stop();
      }
      queues.clear();
    },
  };
}

/**
 * @deprecated Use createMockQueueManager instead
 */
export const createMockQueueFactory = createMockQueueManager;
