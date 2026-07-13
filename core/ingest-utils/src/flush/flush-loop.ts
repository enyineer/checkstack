/**
 * The single-inflight flush loop skeleton shared by ingest pipelines: a periodic
 * timer plus a size-triggered `flushNow`, guaranteeing at most ONE flush cycle
 * runs at a time. The caller supplies `runCycle` (its own drain -> prepare ->
 * write orchestration) and drives the size trigger by calling `flushNow` when
 * its buffer crosses a threshold.
 *
 * This deliberately owns ONLY the timer + single-inflight mechanism; retry,
 * per-key writing, and drop accounting stay in the caller's `runCycle` since
 * they are source-specific. Pure module: no IO of its own.
 */

export interface FlushLoop {
  /**
   * Run one flush cycle now, unless one is already in flight (then the in-flight
   * promise is returned). Also invoked by the periodic timer and the caller's
   * size trigger.
   */
  flushNow(): Promise<void>;
  /** Start the periodic flush timer (idempotent). */
  start(): void;
  /** Stop the timer (test cleanup / shutdown). */
  stop(): void;
}

export function createFlushLoop({
  runCycle,
  intervalMs,
}: {
  /** The caller's flush orchestration for one cycle (drain + write). */
  runCycle: () => Promise<void>;
  /** Timer period between automatic flush cycles. */
  intervalMs: number;
}): FlushLoop {
  let inflight: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  function flushNow(): Promise<void> {
    if (inflight) return inflight;
    inflight = runCycle().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  function start(): void {
    if (timer) return;
    timer = setInterval(() => {
      void flushNow();
    }, intervalMs);
    // Do not keep the process alive solely for the flush timer.
    timer.unref?.();
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { flushNow, start, stop };
}
