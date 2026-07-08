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

export interface CreateInvalidationCoalescerProps<THandle> {
  /** Invoked once per target when its trailing window elapses. */
  flush: (props: { target: string }) => void;
  /** Trailing debounce window, in milliseconds. */
  windowMs: number;
  /** Timer seam; use {@link globalTimerScheduler} in production. */
  scheduler: TimerScheduler<THandle>;
}

export interface InvalidationCoalescer {
  /**
   * Register an invalidation for `target`. Repeated calls for the same target
   * within `windowMs` reset the timer, so a burst flushes exactly once (after
   * the burst quiets). Distinct targets are tracked independently.
   */
  schedule: (props: { target: string }) => void;
  /** Cancel every pending flush. Call on unmount to avoid leaked timers. */
  dispose: () => void;
}

export function createInvalidationCoalescer<THandle>({
  flush,
  windowMs,
  scheduler,
}: CreateInvalidationCoalescerProps<THandle>): InvalidationCoalescer {
  const pending = new Map<string, THandle>();

  const schedule = ({ target }: { target: string }): void => {
    const existing = pending.get(target);
    if (existing !== undefined) {
      scheduler.clear({ handle: existing });
    }
    const handle = scheduler.set({
      delayMs: windowMs,
      handler: () => {
        pending.delete(target);
        flush({ target });
      },
    });
    pending.set(target, handle);
  };

  const dispose = (): void => {
    for (const handle of pending.values()) {
      scheduler.clear({ handle });
    }
    pending.clear();
  };

  return { schedule, dispose };
}
