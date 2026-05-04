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

/**
 * Schedule configuration: either interval-based or cron-based
 */
export type RecurringSchedule =
  | { intervalSeconds: number; cronPattern?: never }
  | { cronPattern: string; intervalSeconds?: never };

/**
 * Details of a recurring job for migration purposes
 */
export type RecurringJobDetails<T = unknown> = {
  jobId: string;
  data: T;
  priority?: number;
  nextRunAt?: Date;
} & RecurringSchedule;

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
    },
  ): Promise<string>;

  /**
   * Register a consumer to process jobs
   *
   * BREAKING CHANGE: Now requires ConsumeOptions with consumerGroup
   */
  consume(consumer: QueueConsumer<T>, options: ConsumeOptions): Promise<void>;

  /**
   * Schedule a recurring job that executes at regular intervals or on a cron schedule.
   *
   * Accepts EITHER `intervalSeconds` (fixed interval) OR `cronPattern` (cron expression).
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
      /** Optional delay before first execution (for delta-based scheduling) */
      startDelay?: number;
      /** Optional priority */
      priority?: number;
    } & RecurringSchedule,
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
   * Get details of a recurring job for migration purposes
   * @param jobId - Job ID
   * @returns Job details or undefined if not found
   */
  getRecurringJobDetails(
    jobId: string,
  ): Promise<RecurringJobDetails<T> | undefined>;

  /**
   * Get the number of jobs currently being processed
   * Used to warn users before switching backends
   */
  getInFlightCount(): Promise<number>;

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

  /**
   * List jobs in a particular state for the Infrastructure runtime panel,
   * paginated.
   *
   * Implementations MUST:
   * - Return summaries only (no payloads).
   * - Honour `opts.offset` and `opts.limit`.
   * - For `completed` / `failed`: return the most recent first.
   * - For `active` / `waiting` / `delayed`: return the oldest first
   *   (FIFO order — what users typically want to see).
   * - Set `total` to a cheap exact count when possible, or `null` when not.
   * - Set `hasMore` correctly so the UI can disable the "next" control.
   *
   * Backends without affordable history (e.g. fire-and-forget transports)
   * may return `{ items: [], total: 0, hasMore: false }` for terminal states.
   */
  listJobs(opts: ListJobsOptions): Promise<ListJobsResult>;
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
  /**
   * Whether these stats reflect the local process only (`"instance"`) or
   * the entire deployment cluster (`"cluster"`). Backends that share state
   * across replicas (e.g. BullMQ on Redis) report `"cluster"`. Backends
   * that hold state in-process (e.g. the in-memory queue) report
   * `"instance"`; in horizontally scaled deployments, each replica returns
   * its own numbers.
   */
  scope: "instance" | "cluster";
}

/**
 * Lifecycle states a job can be in. Mirrors BullMQ for consistency, with
 * one virtual addition: `"pending"` is the union of `"waiting"` and
 * `"delayed"`. Most operators think of "pending work" as both — the
 * Infrastructure UI exposes it as a single tab, and the existing
 * `QueueStats.pending` already aggregates both counts.
 */
export type JobState =
  | "pending"
  | "waiting"
  | "active"
  | "delayed"
  | "completed"
  | "failed";

/**
 * Inspection summary for a single job. Carries no payload — payloads can
 * contain secrets, so they're surfaced (if at all) behind a separate
 * manage-access RPC. The Infrastructure runtime panel uses these summaries
 * for the Active / Failed / Completed sub-tables.
 */
export interface JobSummary {
  id: string;
  /** Optional job/queue name for display. */
  name?: string;
  state: JobState;
  /** Time the job was first enqueued. */
  enqueuedAt: Date;
  /** Time the job started processing, if applicable. */
  startedAt?: Date;
  /** Time the job finished (completed or failed), if applicable. */
  finishedAt?: Date;
  /** Attempts made so far (1-based on completion, 0 before first run). */
  attempts: number;
  /** Failure message, only set when `state === "failed"`. */
  failedReason?: string;
  /**
   * For recurring schedules and delayed jobs: the absolute time of the
   * next planned execution. Lets the UI render a "Next run" column for
   * pending/delayed rows so cron-scheduled work (e.g. healthchecks) is
   * visible between fires.
   */
  nextRunAt?: Date;
  /**
   * Whether this row represents a recurring schedule (cron / interval)
   * rather than a one-shot enqueue. Used by the UI to label such rows
   * distinctly so operators can tell scheduled work from ad-hoc work.
   */
  recurring?: boolean;
}

/**
 * Options for {@link Queue.listJobs}. Offset-based pagination — backends
 * that natively use cursors (BullMQ, Redis SCAN, etc.) translate internally.
 */
export interface ListJobsOptions {
  state: JobState;
  /** Zero-based offset into the result set. */
  offset: number;
  /** Maximum summaries to return. Implementations should cap at a reasonable upper bound. */
  limit: number;
}

/**
 * Paginated result for {@link Queue.listJobs}.
 */
export interface ListJobsResult {
  items: JobSummary[];
  /** Total job count for the requested state, or `null` if the backend can't compute it cheaply. */
  total: number | null;
  /** Whether more items exist past `offset + items.length`. */
  hasMore: boolean;
}
