export interface QueueJob<T = unknown> {
  id: string;
  data: T;
  priority?: number;
  timestamp: Date;
}

export interface QueueConsumer<T = unknown> {
  (job: QueueJob<T>): Promise<void>;
}

export interface Queue<T = unknown> {
  /**
   * Enqueue a job for processing
   */
  enqueue(data: T, options?: { priority?: number }): Promise<string>;

  /**
   * Register a consumer to process jobs
   * The consumer will be called with limited concurrency
   */
  consume(consumer: QueueConsumer<T>): Promise<void>;

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
}
