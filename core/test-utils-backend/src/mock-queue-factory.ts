import type {
  Queue,
  QueueManager,
  QueueJob,
  SwitchResult,
  RecurringJobInfo,
  RecurringJobDetails,
} from "@checkstack/queue-api";
import { extractErrorMessage } from "@checkstack/common";

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
            // Mock queue catches handler errors like the real implementation
            // (which reaches its retry/fail path). Log the MESSAGE only, never
            // the raw Error object: bun renders a logged `Error` as a red
            // `error:` block with a full stack, so an expected/caught failure
            // (e.g. the event-bus "one listener fails, others continue" test)
            // masqueraded as an uncaught error and got counted as a suite error
            // even though every test passed. A string keeps the debug signal
            // without the false alarm. The real queue logs via its (silent in
            // tests) Logger and produces no such block.
            console.error(
              `Mock queue caught error: ${extractErrorMessage(error)}`,
            );
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
          // Store intervalSeconds if present (XOR pattern - one must be defined)
          intervalSeconds:
            "intervalSeconds" in options ? options.intervalSeconds! : 0,
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
        jobId,
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
        scope: "instance" as const,
      }),
      listJobs: async () => ({ items: [], total: 0, hasMore: false }),
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
    getAggregatedStats: async () => ({
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      consumerGroups: 0,
      scope: "instance" as const,
    }),
    listJobs: async () => ({ items: [], total: 0, hasMore: false }),
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
