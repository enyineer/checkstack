import {
  Queue,
  QueueJob,
  QueueConsumer,
  QueueStats,
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
 * In-memory queue implementation with async concurrency control
 */
export class InMemoryQueue<T> implements Queue<T> {
  private jobs: QueueJob<T>[] = [];
  private consumer: QueueConsumer<T> | undefined;
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

    // Trigger processing if consumer is registered
    if (this.consumer && !this.stopped) {
      this.processNext();
    }

    return job.id;
  }

  async consume(consumer: QueueConsumer<T>): Promise<void> {
    this.consumer = consumer;

    // Start processing existing jobs
    while (this.jobs.length > 0 && !this.stopped) {
      this.processNext();
    }
  }

  private async processNext(): Promise<void> {
    const job = this.jobs.shift();
    if (!job || !this.consumer) return;

    // Acquire semaphore permit
    await this.semaphore.acquire();

    this.processing++;

    // Process job asynchronously
    this.consumer(job)
      .then(() => {
        this.stats.completed++;
      })
      .catch((error) => {
        console.error(`Job ${job.id} failed:`, error);
        this.stats.failed++;
      })
      .finally(() => {
        this.processing--;
        this.semaphore.release();

        // Process next job if available
        if (this.jobs.length > 0 && !this.stopped) {
          this.processNext();
        }
      });
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
    };
  }
}
