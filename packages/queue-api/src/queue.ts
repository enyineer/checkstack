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
  enqueue(data: T, options?: { priority?: number }): Promise<string>;

  /**
   * Register a consumer to process jobs
   *
   * BREAKING CHANGE: Now requires ConsumeOptions with consumerGroup
   */
  consume(consumer: QueueConsumer<T>, options: ConsumeOptions): Promise<void>;

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
