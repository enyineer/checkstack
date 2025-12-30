import {
  Queue,
  QueueJob,
  QueueConsumer,
  QueueStats,
  ConsumeOptions,
} from "@checkmate/queue-api";
import { InMemoryQueueConfig } from "./plugin";

/**
 * Simple semaphore for concurrency control
 */
class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    this.permits++;
    const resolve = this.waiting.shift();
    if (resolve) {
      this.permits--;
      resolve();
    }
  }
}

/**
 * Consumer group state tracking
 */
interface ConsumerGroupState<T> {
  consumers: Array<{
    id: string;
    handler: QueueConsumer<T>;
    maxRetries: number;
  }>;
  nextConsumerIndex: number; // For round-robin within group
  processedJobIds: Set<string>; // Track which jobs this group has processed
}

/**
 * In-memory queue implementation with consumer group support
 */
export class InMemoryQueue<T> implements Queue<T> {
  private jobs: QueueJob<T>[] = [];
  private consumerGroups = new Map<string, ConsumerGroupState<T>>();
  private semaphore: Semaphore;
  private stopped = false;
  private processing = 0;
  private stats = {
    completed: 0,
    failed: 0,
  };

  constructor(private name: string, private config: InMemoryQueueConfig) {
    this.semaphore = new Semaphore(config.concurrency);
  }

  async enqueue(data: T, options?: { priority?: number }): Promise<string> {
    if (this.jobs.length >= this.config.maxQueueSize) {
      throw new Error(
        `Queue '${this.name}' is full (max: ${this.config.maxQueueSize})`
      );
    }

    const job: QueueJob<T> = {
      id: crypto.randomUUID(),
      data,
      priority: options?.priority ?? 0,
      timestamp: new Date(),
      attempts: 0,
    };

    // Insert job in priority order (higher priority first)
    const insertIndex = this.jobs.findIndex(
      (existingJob) => existingJob.priority! < job.priority!
    );

    if (insertIndex === -1) {
      this.jobs.push(job);
    } else {
      this.jobs.splice(insertIndex, 0, job);
    }

    // Trigger processing for all consumer groups
    if (!this.stopped) {
      void this.processNext();
    }

    return job.id;
  }

  async consume(
    consumer: QueueConsumer<T>,
    options: ConsumeOptions
  ): Promise<void> {
    const { consumerGroup, maxRetries = 3 } = options;

    // Get or create consumer group
    let groupState = this.consumerGroups.get(consumerGroup);
    if (!groupState) {
      groupState = {
        consumers: [],
        nextConsumerIndex: 0,
        processedJobIds: new Set(),
      };
      this.consumerGroups.set(consumerGroup, groupState);
    }

    // Add consumer to group
    groupState.consumers.push({
      id: crypto.randomUUID(),
      handler: consumer,
      maxRetries,
    });

    // Start processing existing jobs
    if (!this.stopped) {
      void this.processNext();
    }
  }

  private async processNext(): Promise<void> {
    if (this.jobs.length === 0 || this.consumerGroups.size === 0) {
      return;
    }

    // For each consumer group, check if there's a job they haven't processed
    for (const [groupId, groupState] of this.consumerGroups.entries()) {
      if (groupState.consumers.length === 0) continue;

      // Find next unprocessed job for this group
      const job = this.jobs.find((j) => !groupState.processedJobIds.has(j.id));

      if (!job) continue;

      // Mark as processed by this group
      groupState.processedJobIds.add(job.id);

      // Select consumer via round-robin
      const consumerIndex =
        groupState.nextConsumerIndex % groupState.consumers.length;
      const selectedConsumer = groupState.consumers[consumerIndex];
      groupState.nextConsumerIndex++;

      // Process job (don't await - process asynchronously)
      void this.processJob(job, selectedConsumer, groupId, groupState);
    }

    // Remove fully processed jobs
    this.jobs = this.jobs.filter((job) => {
      // Job is done if all groups have processed it
      return ![...this.consumerGroups.values()].every((group) =>
        group.processedJobIds.has(job.id)
      );
    });
  }

  private async processJob(
    job: QueueJob<T>,
    consumer: ConsumerGroupState<T>["consumers"][0],
    groupId: string,
    groupState: ConsumerGroupState<T>
  ): Promise<void> {
    await this.semaphore.acquire();
    this.processing++;

    try {
      await consumer.handler(job);
      this.stats.completed++;
    } catch (error) {
      console.error(
        `Job ${job.id} failed in group ${groupId} (attempt ${job.attempts}):`,
        error
      );

      // Retry logic
      if (job.attempts! < consumer.maxRetries) {
        job.attempts!++;

        // Remove from processed set to allow retry
        groupState.processedJobIds.delete(job.id);

        // Re-trigger processing with exponential backoff
        const delay = Math.pow(2, job.attempts!) * 1000;
        setTimeout(() => {
          if (!this.stopped) {
            void this.processNext();
          }
        }, delay);
      } else {
        this.stats.failed++;
      }
    } finally {
      this.processing--;
      this.semaphore.release();

      // Process next job if available
      if (this.jobs.length > 0 && !this.stopped) {
        void this.processNext();
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;

    // Wait for all processing jobs to complete
    while (this.processing > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async getStats(): Promise<QueueStats> {
    return {
      pending: this.jobs.length,
      processing: this.processing,
      completed: this.stats.completed,
      failed: this.stats.failed,
      consumerGroups: this.consumerGroups.size,
    };
  }
}
