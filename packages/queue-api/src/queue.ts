export interface QueueJob<T = unknown> {
  id: string;
  data: T;
  priority?: number;
  timestamp: Date;
  /**
   * Number of processing attempts (for retry logic)
   */
  attempts?: number;
}

export interface QueueConsumer<T = unknown> {
  (job: QueueJob<T>): Promise<void>;
}

export interface ConsumeOptions {
  /**
   * Consumer group ID for load balancing.
   *
   * Messages are distributed across consumers in the same group (competing consumers).
   * Each consumer group receives a copy of each message (broadcast).
   *
   * Example:
   * - Same group ID = work queue (only one consumer per group gets the message)
   * - Unique group ID per instance = broadcast (all instances get the message)
   */
  consumerGroup: string;

  /**
   * Maximum retry attempts on failure
   * @default 3
   */
  maxRetries?: number;
}

export interface Queue<T = unknown> {
  /**
   * Enqueue a job for processing
   */
  enqueue(
    data: T,
    options?: {
      priority?: number;
      /**
       * Delay in seconds before the job becomes available for processing
       * Queue backends should not make this job available until the delay expires
       */
      startDelay?: number;
      /**
       * Optional unique job ID for deduplication
       * If provided and a job with this ID already exists, behavior depends on queue implementation
       */
      jobId?: string;
    }
  ): Promise<string>;

  /**
   * Register a consumer to process jobs
   *
   * BREAKING CHANGE: Now requires ConsumeOptions with consumerGroup
   */
  consume(consumer: QueueConsumer<T>, options: ConsumeOptions): Promise<void>;

  /**
   * Schedule a recurring job that executes at regular intervals.
   *
   * UPDATE SEMANTICS: Calling this method with an existing jobId will UPDATE
   * the recurring job configuration (interval, payload, priority, etc.).
   * The queue implementation MUST:
   * 1. Cancel any pending scheduled execution of the old job
   * 2. Apply the new configuration
   * 3. Schedule the next execution with the new startDelay (or immediately if not provided)
   *
   * @param data - Job payload
   * @param options - Recurring job options
   * @returns Job ID
   */
  scheduleRecurring(
    data: T,
    options: {
      /**
       * Unique job ID for deduplication and updates.
       * Calling scheduleRecurring with the same jobId updates the existing job.
       */
      jobId: string;
      /** Interval in seconds between executions */
      intervalSeconds: number;
      /** Optional delay before first execution (for delta-based scheduling) */
      startDelay?: number;
      /** Optional priority */
      priority?: number;
    }
  ): Promise<string>;

  /**
   * Cancel a recurring job
   * @param jobId - Job ID to cancel
   */
  cancelRecurring(jobId: string): Promise<void>;

  /**
   * List all recurring job IDs
   * Used for reconciliation to detect orphaned jobs
   * @returns Array of job IDs for all recurring jobs
   */
  listRecurringJobs(): Promise<string[]>;

  /**
   * Test connection to the queue backend
   * @throws Error if connection fails
   */
  testConnection(): Promise<void>;

  /**
   * Stop consuming jobs and cleanup
   */
  stop(): Promise<void>;

  /**
   * Get queue statistics
   */
  getStats(): Promise<QueueStats>;
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  /**
   * Number of active consumer groups
   */
  consumerGroups: number;
}
