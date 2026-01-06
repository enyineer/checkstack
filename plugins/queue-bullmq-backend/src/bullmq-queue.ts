import {
  Queue,
  QueueJob,
  QueueConsumer,
  QueueStats,
  ConsumeOptions,
  RecurringJobDetails,
} from "@checkmate-monitor/queue-api";
import { Queue as BullQueue, Worker, JobsOptions } from "bullmq";
import type { BullMQConfig } from "./plugin";

/**
 * Consumer group state tracking
 */
interface ConsumerGroupState {
  worker: Worker;
  consumerCount: number;
}

/**
 * BullMQ-based queue implementation
 */
export class BullMQQueue<T = unknown> implements Queue<T> {
  private queue: BullQueue;
  private consumerGroups = new Map<string, ConsumerGroupState>();
  private stopped = false;

  constructor(private name: string, private config: BullMQConfig) {
    // Initialize BullMQ Queue with Redis connection
    this.queue = new BullQueue(name, {
      connection: {
        host: config.host,
        port: config.port,
        password: config.password,
        db: config.db,
        // Disable automatic reconnection and retries for immediate failure
        // eslint-disable-next-line unicorn/no-null
        retryStrategy: () => null, // Don't retry, fail immediately
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        connectTimeout: 5000, // 5 second connection timeout
      },
      prefix: config.keyPrefix,
    });
  }

  /**
   * Test Redis connection by attempting a simple operation
   * @throws Error if connection fails
   */
  async testConnection(): Promise<void> {
    try {
      // Try to get job counts - this will fail if Redis is not accessible
      await this.queue.getJobCounts();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to connect to Redis at ${this.config.host}:${this.config.port}: ${message}`
      );
    }
  }

  async enqueue(
    data: T,
    options?: {
      priority?: number;
      startDelay?: number;
      jobId?: string;
    }
  ): Promise<string> {
    if (this.stopped) {
      throw new Error("Queue has been stopped");
    }

    const jobOptions: JobsOptions = {};

    if (options?.priority !== undefined) {
      jobOptions.priority = options.priority;
    }

    if (options?.startDelay !== undefined) {
      // Convert seconds to milliseconds
      jobOptions.delay = options.startDelay * 1000;
    }

    if (options?.jobId) {
      jobOptions.jobId = options.jobId;
    }

    const job = await this.queue.add(this.name, data, jobOptions);
    return job.id!;
  }

  async consume(
    consumer: QueueConsumer<T>,
    options: ConsumeOptions
  ): Promise<void> {
    if (this.stopped) {
      throw new Error("Queue has been stopped");
    }

    const { consumerGroup, maxRetries = 3 } = options;

    // Check if worker already exists for this consumer group
    let groupState = this.consumerGroups.get(consumerGroup);

    if (groupState) {
      // Increment consumer count for existing group
      groupState.consumerCount++;
    } else {
      // Create new worker for this consumer group
      const worker = new Worker(
        this.name,
        async (job) => {
          const queueJob: QueueJob<T> = {
            id: job.id!,
            data: job.data as T,
            priority: job.opts.priority,
            timestamp: new Date(job.timestamp),
            attempts: job.attemptsMade,
          };

          await consumer(queueJob);
        },
        {
          connection: {
            host: this.config.host,
            port: this.config.port,
            password: this.config.password,
            db: this.config.db,
          },
          prefix: this.config.keyPrefix,
          concurrency: this.config.concurrency,
          // BullMQ's built-in retry mechanism
          settings: {
            backoffStrategy: (attemptsMade: number) => {
              // Exponential backoff: 2^attemptsMade * 1000ms
              return Math.pow(2, attemptsMade) * 1000;
            },
          },
        }
      );

      // Configure retries at job level via job options
      worker.on("failed", async (job, err) => {
        if (job && job.attemptsMade >= maxRetries) {
          // Max retries exhausted
          console.debug(
            `Job ${job.id} exhausted retries (${job.attemptsMade}/${maxRetries}):`,
            err
          );
        }
      });

      groupState = {
        worker,
        consumerCount: 1,
      };
      this.consumerGroups.set(consumerGroup, groupState);
    }
  }

  async scheduleRecurring(
    data: T,
    options: {
      jobId: string;
      intervalSeconds: number;
      startDelay?: number;
      priority?: number;
    }
  ): Promise<string> {
    if (this.stopped) {
      throw new Error("Queue has been stopped");
    }

    const { jobId, intervalSeconds, startDelay, priority } = options;

    // Use upsertJobScheduler for create-or-update semantics
    await this.queue.upsertJobScheduler(
      jobId,
      {
        every: intervalSeconds * 1000,
        startDate: startDelay
          ? new Date(Date.now() + startDelay * 1000)
          : undefined,
      },
      {
        name: this.name,
        data,
        opts: {
          priority,
        },
      }
    );

    return jobId;
  }

  async cancelRecurring(jobId: string): Promise<void> {
    if (this.stopped) {
      throw new Error("Queue has been stopped");
    }

    await this.queue.removeJobScheduler(jobId);
  }

  async listRecurringJobs(): Promise<string[]> {
    if (this.stopped) {
      throw new Error("Queue has been stopped");
    }

    const schedulers = await this.queue.getJobSchedulers();
    return schedulers.map((scheduler) => scheduler.key);
  }

  async getRecurringJobDetails(
    jobId: string
  ): Promise<RecurringJobDetails<T> | undefined> {
    if (this.stopped) {
      throw new Error("Queue has been stopped");
    }

    const schedulers = await this.queue.getJobSchedulers();
    const scheduler = schedulers.find((s) => s.key === jobId);

    if (!scheduler) {
      return undefined;
    }

    // BullMQ scheduler template contains the data
    return {
      jobId,
      data: scheduler.template?.data as T,
      intervalSeconds: scheduler.every ? scheduler.every / 1000 : 0,
      priority: scheduler.template?.opts?.priority,
      nextRunAt: scheduler.next ? new Date(scheduler.next) : undefined,
    };
  }

  async getInFlightCount(): Promise<number> {
    const counts = await this.queue.getJobCounts("active");
    return counts.active || 0;
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }

    this.stopped = true;

    // Close all workers gracefully
    const closePromises: Promise<void>[] = [];
    for (const groupState of this.consumerGroups.values()) {
      closePromises.push(groupState.worker.close());
    }
    await Promise.all(closePromises);

    // Close queue connection
    await this.queue.close();

    this.consumerGroups.clear();
  }

  async getStats(): Promise<QueueStats> {
    const counts = await this.queue.getJobCounts(
      "waiting",
      "active",
      "completed",
      "failed"
    );

    return {
      pending: counts.waiting || 0,
      processing: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      consumerGroups: this.consumerGroups.size,
    };
  }
}
