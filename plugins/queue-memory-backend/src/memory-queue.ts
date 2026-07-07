import {
  Queue,
  QueueJob,
  QueueConsumer,
  QueueStats,
  ConsumeOptions,
  RecurringJobDetails,
  RecurringSchedule,
  JobSummary,
  ListJobsOptions,
  ListJobsResult,
  JobState,
} from "@checkstack/queue-api";
import type { Logger } from "@checkstack/backend-api";
import {
  queueEnqueuedCounter,
  queueProcessedCounter,
} from "@checkstack/backend-api";
import { extractErrorMessage } from "@checkstack/common";
import { InMemoryQueueConfig } from "./plugin";
import parser from "cron-parser";

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
 * Maximum setTimeout delay (~24.8 days) to avoid overflow
 */
const MAX_TIMEOUT = 2_147_483_647;

/**
 * Recurring job metadata - supports both interval and cron patterns
 */
type RecurringJobMetadata<T> = {
  jobId: string;
  payload: T;
  priority: number;
  enabled: boolean;
  timerId?: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>;
} & RecurringSchedule;

/** Maximum history entries kept per terminal state (completed/failed). */
const HISTORY_CAP = 200;

interface ActiveJobInfo {
  id: string;
  enqueuedAt: Date;
  startedAt: Date;
  attempts: number;
}

interface TerminalJobInfo {
  id: string;
  state: "completed" | "failed";
  enqueuedAt: Date;
  startedAt: Date;
  finishedAt: Date;
  attempts: number;
  failedReason?: string;
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

  /** Currently-processing jobs, keyed by job id. */
  private activeJobs = new Map<string, ActiveJobInfo>();
  /** Most-recent-first ring buffer of completed jobs (capped at {@link HISTORY_CAP}). */
  private completedHistory: TerminalJobInfo[] = [];
  /** Most-recent-first ring buffer of failed jobs (capped at {@link HISTORY_CAP}). */
  private failedHistory: TerminalJobInfo[] = [];

  private logger: Logger;
  private heartbeatInterval: ReturnType<typeof setInterval> | undefined;

  constructor(
    private name: string,
    private config: InMemoryQueueConfig,
    logger: Logger,
  ) {
    this.semaphore = new Semaphore(config.concurrency);
    this.logger = logger;

    // Start heartbeat for resilient job processing (e.g., after system sleep)
    if (config.heartbeatIntervalMs > 0) {
      this.heartbeatInterval = setInterval(() => {
        if (
          !this.stopped &&
          this.jobs.length > 0 &&
          this.consumerGroups.size > 0
        ) {
          void this.processNext();
        }
      }, config.heartbeatIntervalMs);
    }
  }

  /**
   * Schedule a callback after a delay.
   */
  private scheduleDelayed(ms: number, callback: () => void): void {
    setTimeout(() => {
      if (!this.stopped) {
        callback();
      }
    }, ms);
  }

  async enqueue(
    data: T,
    options?: { priority?: number; startDelay?: number; jobId?: string },
  ): Promise<string> {
    if (this.jobs.length >= this.config.maxQueueSize) {
      throw new Error(
        `Queue '${this.name}' is full (max: ${this.config.maxQueueSize})`,
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
      (existingJob) => existingJob.priority! < job.priority!,
    );

    if (insertIndex === -1) {
      this.jobs.push(job);
    } else {
      this.jobs.splice(insertIndex, 0, job);
    }

    // Metrics (OTel no-op unless enabled).
    queueEnqueuedCounter().add(1, { queue: this.name });

    // Trigger processing for all consumer groups (or schedule for later)
    if (!this.stopped) {
      if (options?.startDelay) {
        // Schedule processing when the job becomes available
        const scheduledDelayMs =
          options.startDelay * 1000 * (this.config.delayMultiplier ?? 1);
        this.scheduleDelayed(scheduledDelayMs, () => {
          void this.processNext();
        });
      } else {
        void this.processNext();
      }
    }

    return job.id;
  }

  async consume(
    consumer: QueueConsumer<T>,
    options: ConsumeOptions,
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
      priority?: number;
    } & RecurringSchedule,
  ): Promise<string> {
    const { jobId, priority = 0 } = options;

    // Check if this is an update to an existing recurring job
    const existingMetadata = this.recurringJobs.get(jobId);
    if (existingMetadata) {
      // UPDATE CASE: Clear existing timer and pending executions
      if (existingMetadata.timerId) {
        if ("cronPattern" in existingMetadata) {
          clearTimeout(existingMetadata.timerId);
        } else {
          clearInterval(existingMetadata.timerId);
        }
      }

      // Find and remove any pending jobs for this recurring job
      this.jobs = this.jobs.filter((job) => {
        if (job.id.startsWith(jobId + ":")) {
          for (const group of this.consumerGroups.values()) {
            group.processedJobIds.delete(job.id);
          }
          return false;
        }
        return true;
      });
    }

    // Handle cron-based scheduling
    if ("cronPattern" in options && options.cronPattern) {
      const cronPattern = options.cronPattern;

      // Wall-clock cron scheduling with MAX_TIMEOUT handling
      const scheduleNextCronRun = () => {
        if (this.stopped) return;

        const metadata = this.recurringJobs.get(jobId);
        if (!metadata || !metadata.enabled) return;

        try {
          const interval = parser.parseExpression(cronPattern);
          const nextRun = interval.next().toDate();
          const delayMs = nextRun.getTime() - Date.now();

          if (delayMs > MAX_TIMEOUT) {
            // Chunk long delays - wake up periodically to recalculate
            metadata.timerId = setTimeout(scheduleNextCronRun, MAX_TIMEOUT);
            return;
          }

          metadata.timerId = setTimeout(
            () => {
              if (!this.stopped && metadata.enabled) {
                const uniqueId = `${jobId}:${Date.now()}-${Math.random()
                  .toString(36)
                  .slice(2, 8)}`;
                void this.enqueue(data, { jobId: uniqueId, priority });
                scheduleNextCronRun(); // Reschedule for next cron time
              }
            },
            Math.max(0, delayMs),
          );
        } catch (error) {
          this.logger.error(`Invalid cron pattern "${cronPattern}":`, error);
        }
      };

      // Store recurring job metadata
      this.recurringJobs.set(jobId, {
        jobId,
        cronPattern,
        payload: data,
        priority,
        enabled: true,
      });

      // Start cron scheduling
      scheduleNextCronRun();

      return jobId;
    }

    // Handle interval-based scheduling (original behavior)
    // TypeScript XOR pattern doesn't narrow well, but intervalSeconds is guaranteed here
    const intervalSeconds = options.intervalSeconds!;
    const intervalMs =
      intervalSeconds * 1000 * (this.config.delayMultiplier ?? 1);

    // Create interval for wall-clock scheduling
    const timerId = setInterval(() => {
      if (!this.stopped) {
        const uniqueId = `${jobId}:${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        void this.enqueue(data, { jobId: uniqueId, priority });
      }
    }, intervalMs);

    // Store recurring job metadata with interval ID
    this.recurringJobs.set(jobId, {
      jobId,
      intervalSeconds,
      payload: data,
      priority,
      enabled: true,
      timerId,
    });

    // Schedule first execution immediately for interval-based jobs
    const firstJobId = `${jobId}:${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    await this.enqueue(data, { jobId: firstJobId, priority });

    return jobId;
  }

  async cancelRecurring(jobId: string): Promise<void> {
    const metadata = this.recurringJobs.get(jobId);
    if (metadata) {
      metadata.enabled = false; // Mark as disabled

      // Clear the timer (works for both setTimeout and setInterval)
      if (metadata.timerId) {
        if ("cronPattern" in metadata) {
          clearTimeout(metadata.timerId);
        } else {
          clearInterval(metadata.timerId);
        }
        metadata.timerId = undefined;
      }

      // Also cancel any pending jobs
      this.jobs = this.jobs.filter((job) => {
        if (job.id.startsWith(jobId + ":")) {
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
    jobId: string,
  ): Promise<RecurringJobDetails<T> | undefined> {
    const metadata = this.recurringJobs.get(jobId);
    if (!metadata || !metadata.enabled) {
      return undefined;
    }

    const baseDetails = {
      jobId: metadata.jobId,
      data: metadata.payload,
      priority: metadata.priority,
    };

    if ("cronPattern" in metadata && metadata.cronPattern) {
      return { ...baseDetails, cronPattern: metadata.cronPattern };
    }
    return { ...baseDetails, intervalSeconds: metadata.intervalSeconds! };
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
        (j) => !groupState.processedJobIds.has(j.id) && j.availableAt <= now,
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
        group.processedJobIds.has(job.id),
      );
    });
  }

  private pushHistory(buf: TerminalJobInfo[], info: TerminalJobInfo): void {
    buf.unshift(info);
    if (buf.length > HISTORY_CAP) {
      buf.length = HISTORY_CAP;
    }
  }

  private async processJob(
    job: InternalQueueJob<T>,
    consumer: ConsumerGroupState<T>["consumers"][0],
    groupId: string,
    groupState: ConsumerGroupState<T>,
  ): Promise<void> {
    await this.semaphore.acquire();
    this.processing++;
    const startedAt = new Date();
    this.activeJobs.set(job.id, {
      id: job.id,
      enqueuedAt: job.timestamp,
      startedAt,
      attempts: (job.attempts ?? 0) + 1,
    });

    let isRetrying = false;

    try {
      await consumer.handler(job);
      this.stats.completed++;
      queueProcessedCounter().add(1, { queue: this.name, status: "completed" });
      this.pushHistory(this.completedHistory, {
        id: job.id,
        state: "completed",
        enqueuedAt: job.timestamp,
        startedAt,
        finishedAt: new Date(),
        attempts: (job.attempts ?? 0) + 1,
      });
    } catch (error) {
      this.logger.error(
        `Job ${job.id} failed in group ${groupId} (attempt ${job.attempts}):`,
        error,
      );

      // Retry logic
      if (job.attempts! < consumer.maxRetries) {
        job.attempts!++;
        isRetrying = true;

        // Remove from processed set to allow retry
        groupState.processedJobIds.delete(job.id);

        // Re-add job to queue for retry (with priority to process soon, preserving availableAt)
        const insertIndex = this.jobs.findIndex(
          (existingJob) => existingJob.priority! < (job.priority ?? 0),
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
        this.scheduleDelayed(delay, () => {
          void this.processNext();
        });
      } else {
        this.stats.failed++;
        queueProcessedCounter().add(1, { queue: this.name, status: "failed" });
        this.pushHistory(this.failedHistory, {
          id: job.id,
          state: "failed",
          enqueuedAt: job.timestamp,
          startedAt,
          finishedAt: new Date(),
          attempts: (job.attempts ?? 0) + 1,
          failedReason: extractErrorMessage(error),
        });
      }
    } finally {
      this.activeJobs.delete(job.id);
      this.processing--;
      this.semaphore.release();

      // Process next job if available (but not if we're retrying - setTimeout will handle it)
      if (!isRetrying && this.jobs.length > 0 && !this.stopped) {
        void this.processNext();
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;

    // Clear heartbeat interval
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }

    // Clear all recurring job timers (both cron and interval)
    for (const metadata of this.recurringJobs.values()) {
      if (metadata.timerId) {
        if ("cronPattern" in metadata) {
          clearTimeout(metadata.timerId);
        } else {
          clearInterval(metadata.timerId);
        }
        metadata.timerId = undefined;
      }
      metadata.enabled = false;
    }

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
      scope: "instance",
    };
  }

  /**
   * Synthesise `JobSummary` rows for recurring schedules so the UI can
   * surface them under Pending (and Delayed) between actual fires.
   *
   * The in-memory queue runs cron via `setTimeout` and intervals via
   * `setInterval`; neither materialises the next execution as an entry
   * in `this.jobs` until the timer fires. Without these synthetic rows,
   * cron-scheduled work like healthchecks would be invisible to operators
   * looking at the runtime panel.
   */
  private synthesizeRecurringSummaries(): JobSummary[] {
    const out: JobSummary[] = [];
    for (const meta of this.recurringJobs.values()) {
      if (!meta.enabled) continue;
      let nextRunAt: Date | undefined;
      if ("cronPattern" in meta && meta.cronPattern) {
        try {
          nextRunAt = parser
            .parseExpression(meta.cronPattern)
            .next()
            .toDate();
        } catch {
          nextRunAt = undefined;
        }
      } else if (meta.intervalSeconds) {
        // Best-effort: assume "now + intervalMs". The exact next-tick of
        // an active setInterval isn't observable from outside; this gives
        // operators an upper bound on the wait.
        const intervalMs =
          meta.intervalSeconds * 1000 * (this.config.delayMultiplier ?? 1);
        nextRunAt = new Date(Date.now() + intervalMs);
      }
      // For synthesised recurring rows, `enqueuedAt` represents "this
      // schedule is currently active as of now" — not a future fire time.
      // The future fire time goes in `nextRunAt`. Using a future date
      // here would make the UI's "x ago" relative formatting report
      // negative seconds.
      out.push({
        id: meta.jobId,
        name: this.name,
        state: "delayed",
        enqueuedAt: new Date(),
        attempts: 0,
        nextRunAt,
        recurring: true,
      });
    }
    return out;
  }

  async listJobs(opts: ListJobsOptions): Promise<ListJobsResult> {
    const limit = Math.max(0, opts.limit);
    const offset = Math.max(0, opts.offset);
    const state: JobState = opts.state;
    const now = Date.now();

    const slice = <X>(all: X[]): { items: X[]; total: number } => ({
      items: all.slice(offset, offset + limit),
      total: all.length,
    });

    let result: { items: JobSummary[]; total: number };

    if (state === "completed" || state === "failed") {
      const src =
        state === "completed" ? this.completedHistory : this.failedHistory;
      const { items, total } = slice(src);
      result = {
        total,
        items: items.map((j) => ({
          id: j.id,
          name: this.name,
          state,
          enqueuedAt: j.enqueuedAt,
          startedAt: j.startedAt,
          finishedAt: j.finishedAt,
          attempts: j.attempts,
          failedReason: j.failedReason,
        })),
      };
    } else if (state === "active") {
      const sorted = [...this.activeJobs.values()].toSorted(
        (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
      );
      const { items, total } = slice(sorted);
      result = {
        total,
        items: items.map((j) => ({
          id: j.id,
          name: this.name,
          state: "active",
          enqueuedAt: j.enqueuedAt,
          startedAt: j.startedAt,
          attempts: j.attempts,
        })),
      };
    } else {
      // pending / waiting / delayed: derived from this.jobs PLUS synthetic
      // entries for active recurring schedules (so cron jobs are visible
      // between fires).
      // - waiting: availableAt <= now
      // - delayed: availableAt > now (real jobs) + recurring schedules
      // - pending: union, sorted by enqueuedAt (FIFO)
      const isDelayed = (job: InternalQueueJob<T>) =>
        job.availableAt.getTime() > now;

      const baseSummaries: JobSummary[] = this.jobs
        .filter((j) =>
          state === "pending"
            ? true
            : state === "delayed"
              ? isDelayed(j)
              : !isDelayed(j),
        )
        .map((j) => ({
          id: j.id,
          name: this.name,
          state:
            state === "pending"
              ? isDelayed(j)
                ? ("delayed" as const)
                : ("waiting" as const)
              : state,
          enqueuedAt: j.timestamp,
          attempts: j.attempts ?? 0,
        }));

      const recurringSummaries =
        state === "waiting" ? [] : this.synthesizeRecurringSummaries();

      const all = [...baseSummaries, ...recurringSummaries];
      const { items, total } = slice(all);
      result = { items, total };
    }

    return {
      items: result.items,
      total: result.total,
      hasMore: offset + result.items.length < result.total,
    };
  }

  async testConnection(): Promise<void> {
    // In-memory queue is always available
  }
}
