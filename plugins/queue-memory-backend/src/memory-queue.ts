import {
  Queue,
  QueueJob,
  QueueConsumer,
  QueueStats,
  ConsumeOptions,
  RecurringJobDetails,
} from "@checkmate/queue-api";
import { InMemoryQueueConfig } from "./plugin";

/**
 * Extended queue job with availability tracking for delayed jobs
 */
interface InternalQueueJob<T> extends QueueJob<T> {
  availableAt: Date;
}

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
 * Recurring job metadata
 */
interface RecurringJobMetadata<T> {
  jobId: string;
  intervalSeconds: number;
  payload: T;
  priority: number;
  enabled: boolean; // For cancellation
}

/**
 * In-memory queue implementation with consumer group support
 */
export class InMemoryQueue<T> implements Queue<T> {
  private jobs: InternalQueueJob<T>[] = [];
  private consumerGroups = new Map<string, ConsumerGroupState<T>>();
  private recurringJobs = new Map<string, RecurringJobMetadata<T>>();
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

  async enqueue(
    data: T,
    options?: { priority?: number; startDelay?: number; jobId?: string }
  ): Promise<string> {
    if (this.jobs.length >= this.config.maxQueueSize) {
      throw new Error(
        `Queue '${this.name}' is full (max: ${this.config.maxQueueSize})`
      );
    }

    const now = new Date();
    const delayMs = options?.startDelay
      ? options.startDelay * 1000 * (this.config.delayMultiplier ?? 1)
      : 0;
    const availableAt = delayMs > 0 ? new Date(now.getTime() + delayMs) : now;

    // Use custom jobId if provided, otherwise generate one
    const jobId = options?.jobId ?? crypto.randomUUID();

    // Check for duplicate jobId
    if (options?.jobId && this.jobs.some((j) => j.id === options.jobId)) {
      // Job with this ID already exists, skip silently
      return options.jobId;
    }

    const job: InternalQueueJob<T> = {
      id: jobId,
      data,
      priority: options?.priority ?? 0,
      timestamp: now,
      attempts: 0,
      availableAt,
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

    // Trigger processing for all consumer groups (or schedule for later)
    if (!this.stopped) {
      if (options?.startDelay) {
        // Schedule processing when the job becomes available
        const scheduledDelayMs =
          options.startDelay * 1000 * (this.config.delayMultiplier ?? 1);
        setTimeout(() => {
          if (!this.stopped) {
            void this.processNext();
          }
        }, scheduledDelayMs);
      } else {
        void this.processNext();
      }
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

  async scheduleRecurring(
    data: T,
    options: {
      jobId: string;
      intervalSeconds: number;
      startDelay?: number;
      priority?: number;
    }
  ): Promise<string> {
    const { jobId, intervalSeconds, startDelay = 0, priority = 0 } = options;

    // Check if this is an update to an existing recurring job
    const existingMetadata = this.recurringJobs.get(jobId);
    if (existingMetadata) {
      // UPDATE CASE: Cancel pending executions
      // Find and remove any pending jobs for this recurring job
      this.jobs = this.jobs.filter((job) => {
        // Check if this job belongs to the recurring job being updated
        if (job.id.startsWith(jobId + ":")) {
          // Remove from processed sets to prevent orphaned references
          for (const group of this.consumerGroups.values()) {
            group.processedJobIds.delete(job.id);
          }
          return false; // Remove this job
        }
        return true; // Keep other jobs
      });
    }

    // Store or update recurring job metadata
    this.recurringJobs.set(jobId, {
      jobId,
      intervalSeconds,
      payload: data,
      priority,
      enabled: true,
    });

    // Schedule first execution with new configuration
    await this.enqueue(data, {
      jobId: `${jobId}:${Date.now()}`, // Unique ID for this execution
      startDelay,
      priority,
    });

    return jobId;
  }

  async cancelRecurring(jobId: string): Promise<void> {
    const metadata = this.recurringJobs.get(jobId);
    if (metadata) {
      metadata.enabled = false; // Mark as disabled to stop future rescheduling

      // Also cancel any pending jobs
      this.jobs = this.jobs.filter((job) => {
        if (job.id.startsWith(jobId + ":")) {
          // Remove from processed sets
          for (const group of this.consumerGroups.values()) {
            group.processedJobIds.delete(job.id);
          }
          return false;
        }
        return true;
      });
    }
  }

  async listRecurringJobs(): Promise<string[]> {
    return [...this.recurringJobs.keys()];
  }

  async getRecurringJobDetails(
    jobId: string
  ): Promise<RecurringJobDetails<T> | undefined> {
    const metadata = this.recurringJobs.get(jobId);
    if (!metadata || !metadata.enabled) {
      return undefined;
    }
    return {
      jobId: metadata.jobId,
      data: metadata.payload,
      intervalSeconds: metadata.intervalSeconds,
      priority: metadata.priority,
    };
  }

  async getInFlightCount(): Promise<number> {
    return this.processing;
  }

  private async processNext(): Promise<void> {
    if (this.jobs.length === 0 || this.consumerGroups.size === 0) {
      return;
    }

    const now = new Date();

    // For each consumer group, check if there's a job they haven't processed
    for (const [groupId, groupState] of this.consumerGroups.entries()) {
      if (groupState.consumers.length === 0) continue;

      // Find next unprocessed job for this group that is available
      const job = this.jobs.find(
        (j) => !groupState.processedJobIds.has(j.id) && j.availableAt <= now
      );

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
    job: InternalQueueJob<T>,
    consumer: ConsumerGroupState<T>["consumers"][0],
    groupId: string,
    groupState: ConsumerGroupState<T>
  ): Promise<void> {
    await this.semaphore.acquire();
    this.processing++;

    let isRetrying = false;

    try {
      await consumer.handler(job);
      this.stats.completed++;

      // After successful execution, check for recurring job and reschedule
      const recurringJobId = this.findRecurringJobId(job.id);
      if (recurringJobId) {
        const metadata = this.recurringJobs.get(recurringJobId);
        if (metadata?.enabled) {
          // Reschedule for next interval
          void this.enqueue(metadata.payload, {
            jobId: `${recurringJobId}:${Date.now()}`,
            startDelay: metadata.intervalSeconds,
            priority: metadata.priority,
          });
        }
      }
    } catch (error) {
      console.error(
        `Job ${job.id} failed in group ${groupId} (attempt ${job.attempts}):`,
        error
      );

      // Retry logic
      if (job.attempts! < consumer.maxRetries) {
        job.attempts!++;
        isRetrying = true;

        // Remove from processed set to allow retry
        groupState.processedJobIds.delete(job.id);

        // Re-add job to queue for retry (with priority to process soon, preserving availableAt)
        const insertIndex = this.jobs.findIndex(
          (existingJob) => existingJob.priority! < (job.priority ?? 0)
        );
        if (insertIndex === -1) {
          this.jobs.push(job);
        } else {
          this.jobs.splice(insertIndex, 0, job);
        }

        // Re-trigger processing with exponential backoff
        const delay =
          Math.pow(2, job.attempts!) *
          1000 *
          (this.config.delayMultiplier ?? 1);
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

      // Process next job if available (but not if we're retrying - setTimeout will handle it)
      if (!isRetrying && this.jobs.length > 0 && !this.stopped) {
        void this.processNext();
      }
    }
  }

  /**
   * Extract the recurring job ID from an execution job ID
   * Execution jobs have format: "recurringJobId:timestamp"
   */
  private findRecurringJobId(executionJobId: string): string | undefined {
    // Check if this execution job belongs to any recurring job
    for (const [recurringId] of this.recurringJobs) {
      if (executionJobId.startsWith(recurringId + ":")) {
        return recurringId;
      }
    }
    return undefined;
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

  async testConnection(): Promise<void> {
    // In-memory queue is always available
  }
}
