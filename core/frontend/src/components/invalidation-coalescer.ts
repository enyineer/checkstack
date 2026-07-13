/**
 * Coalesces a burst of invalidation requests for the same target into a single
 * trailing flush.
 *
 * `queryClient.invalidateQueries` is idempotent: collapsing many invalidations
 * of the same target within a short window into ONE flush loses no correctness
 * (the single trailing refetch returns the latest server state) — it only
 * removes redundant, mutually-cancelling in-flight refetches. Used by
 * {@link SignalAutoInvalidator} to keep a signal-heavy page (e.g. the catalog
 * during active health checking) from issuing one health-status refetch per
 * realtime signal.
 *
 * The timer seam is injected so the logic is unit-testable with deterministic,
 * controlled time (no real sleeps). Production wiring passes
 * {@link globalTimerScheduler}.
 */

/** Handle returned by the global timer functions. */
export type TimerHandle = ReturnType<typeof setTimeout>;

/**
 * Minimal timer abstraction. Injectable so tests can drive time by hand instead
 * of waiting on wall-clock timeouts.
 */
export interface TimerScheduler<THandle> {
  set: (props: { handler: () => void; delayMs: number }) => THandle;
  clear: (props: { handle: THandle }) => void;
}

/** Production scheduler backed by the global `setTimeout`/`clearTimeout`. */
export const globalTimerScheduler: TimerScheduler<TimerHandle> = {
  set: ({ handler, delayMs }) => setTimeout(handler, delayMs),
  clear: ({ handle }) => clearTimeout(handle),
};

export interface CreateInvalidationCoalescerProps<TJob, THandle> {
  /** Invoked once per bucket when its trailing window elapses. */
  flush: (props: { job: TJob }) => void;
  /**
   * Derive the coalesce bucket key for a job. Jobs sharing a key collapse into
   * one trailing flush; distinct keys are tracked independently. The LAST job
   * scheduled for a key is the one flushed.
   */
  keyOf: (job: TJob) => string;
  /** Trailing debounce window, in milliseconds. */
  windowMs: number;
  /** Timer seam; use {@link globalTimerScheduler} in production. */
  scheduler: TimerScheduler<THandle>;
}

export interface InvalidationCoalescer<TJob> {
  /**
   * Register an invalidation `job`. Repeated calls whose `keyOf` matches within
   * `windowMs` reset the timer, so a burst flushes exactly once (after the
   * burst quiets), with the last scheduled job winning. Distinct keys are
   * tracked independently.
   */
  schedule: (props: { job: TJob }) => void;
  /** Cancel every pending flush. Call on unmount to avoid leaked timers. */
  dispose: () => void;
}

interface PendingEntry<TJob, THandle> {
  handle: THandle;
  job: TJob;
}

export function createInvalidationCoalescer<TJob, THandle>({
  flush,
  keyOf,
  windowMs,
  scheduler,
}: CreateInvalidationCoalescerProps<TJob, THandle>): InvalidationCoalescer<TJob> {
  const pending = new Map<string, PendingEntry<TJob, THandle>>();

  const schedule = ({ job }: { job: TJob }): void => {
    const key = keyOf(job);
    const existing = pending.get(key);
    if (existing !== undefined) {
      scheduler.clear({ handle: existing.handle });
    }
    const handle = scheduler.set({
      delayMs: windowMs,
      handler: () => {
        const entry = pending.get(key);
        pending.delete(key);
        if (entry) flush({ job: entry.job });
      },
    });
    pending.set(key, { handle, job });
  };

  const dispose = (): void => {
    for (const entry of pending.values()) {
      scheduler.clear({ handle: entry.handle });
    }
    pending.clear();
  };

  return { schedule, dispose };
}
