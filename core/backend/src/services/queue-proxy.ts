import type {
  Queue,
  QueueConsumer,
  ConsumeOptions,
  QueueStats,
  RecurringJobDetails,
} from "@checkmate-monitor/queue-api";
import { rootLogger } from "../logger";

/**
 * Stored subscription for replay after backend switch
 */
interface StoredSubscription<T> {
  consumer: QueueConsumer<T>;
  options: ConsumeOptions;
}

/**
 * QueueProxy wraps a real queue implementation and provides:
 * - Stable reference that survives backend switches
 * - Automatic subscription replay when backend changes
 * - Pending operation tracking for graceful switching
 */
export class QueueProxy<T = unknown> implements Queue<T> {
  private delegate: Queue<T> | undefined = undefined;
  private subscriptions = new Map<string, StoredSubscription<T>>();
  private pendingOperations: Promise<unknown>[] = [];
  private stopped = false;

  constructor(private readonly name: string) {}

  /**
   * Switch the underlying queue implementation.
   * Called by QueueManager when backend changes.
   */
  async switchDelegate(newQueue: Queue<T>): Promise<void> {
    rootLogger.debug(`Switching delegate for queue '${this.name}'`);

    // Wait for pending operations to complete
    if (this.pendingOperations.length > 0) {
      rootLogger.debug(
        `Waiting for ${this.pendingOperations.length} pending operations...`
      );
      await Promise.allSettled(this.pendingOperations);
    }

    // Stop old delegate gracefully
    if (this.delegate) {
      await this.delegate.stop();
    }

    // Switch to new implementation
    this.delegate = newQueue;
    this.stopped = false;

    // Re-apply all stored subscriptions
    for (const [group, { consumer, options }] of this.subscriptions) {
      rootLogger.debug(
        `Re-applying subscription for group '${group}' on queue '${this.name}'`
      );
      await this.delegate.consume(consumer, options);
    }
  }

  /**
   * Get the underlying delegate for direct access (use sparingly)
   */
  getDelegate(): Queue<T> | undefined {
    return this.delegate;
  }

  private ensureDelegate(): Queue<T> {
    if (!this.delegate) {
      throw new Error(
        `Queue '${this.name}' not initialized. Ensure QueueManager.loadConfiguration() has been called.`
      );
    }
    if (this.stopped) {
      throw new Error(`Queue '${this.name}' has been stopped.`);
    }
    return this.delegate;
  }

  private trackOperation<R>(operation: Promise<R>): Promise<R> {
    this.pendingOperations.push(operation);
    return operation.finally(() => {
      this.pendingOperations = this.pendingOperations.filter(
        (p) => p !== operation
      );
    });
  }

  async enqueue(
    data: T,
    options?: {
      priority?: number;
      startDelay?: number;
      jobId?: string;
    }
  ): Promise<string> {
    const delegate = this.ensureDelegate();
    return this.trackOperation(delegate.enqueue(data, options));
  }

  async consume(
    consumer: QueueConsumer<T>,
    options: ConsumeOptions
  ): Promise<void> {
    // Store subscription for replay after backend switch
    this.subscriptions.set(options.consumerGroup, { consumer, options });

    // If we have a delegate, apply immediately
    if (this.delegate && !this.stopped) {
      await this.delegate.consume(consumer, options);
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
    const delegate = this.ensureDelegate();
    return this.trackOperation(delegate.scheduleRecurring(data, options));
  }

  async cancelRecurring(jobId: string): Promise<void> {
    const delegate = this.ensureDelegate();
    return this.trackOperation(delegate.cancelRecurring(jobId));
  }

  async listRecurringJobs(): Promise<string[]> {
    const delegate = this.ensureDelegate();
    return delegate.listRecurringJobs();
  }

  async getRecurringJobDetails(
    jobId: string
  ): Promise<RecurringJobDetails<T> | undefined> {
    const delegate = this.ensureDelegate();
    return delegate.getRecurringJobDetails(jobId);
  }

  async getInFlightCount(): Promise<number> {
    const delegate = this.ensureDelegate();
    return delegate.getInFlightCount();
  }

  async testConnection(): Promise<void> {
    const delegate = this.ensureDelegate();
    return delegate.testConnection();
  }

  async stop(): Promise<void> {
    this.stopped = true;

    // Wait for pending operations
    if (this.pendingOperations.length > 0) {
      await Promise.allSettled(this.pendingOperations);
    }

    if (this.delegate) {
      await this.delegate.stop();
    }
  }

  async getStats(): Promise<QueueStats> {
    const delegate = this.ensureDelegate();
    return delegate.getStats();
  }

  /**
   * Get subscription count (for testing/debugging)
   */
  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }
}
