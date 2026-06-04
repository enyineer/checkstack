/**
 * Build a one-shot graceful-exit handler shared by every exit path of the dev
 * runner (ink unmount via `q` / Ctrl-C, and external SIGINT / SIGTERM).
 *
 * The bug this guards against: pressing Ctrl-C (or receiving a signal) used to
 * terminate the runner WITHOUT tearing down the supervised children, leaving a
 * stale backend bound to its port. Routing every exit through this helper
 * guarantees `shutdown()` runs to completion BEFORE the process is finalized,
 * and the `started` latch makes it idempotent so two near-simultaneous triggers
 * (e.g. an unmount and a signal) shut down only once. `finalize` still runs even
 * if `shutdown` rejects, so the terminal is always restored and the process
 * always exits.
 */
export function createGracefulShutdown(args: {
  shutdown: () => Promise<void>;
  finalize: () => void;
}): () => void {
  const { shutdown, finalize } = args;
  let started = false;
  return () => {
    if (started) {
      return;
    }
    started = true;
    // `finally` runs `finalize` whether shutdown resolves or rejects; the
    // trailing `catch` swallows a rejected shutdown so it never surfaces as an
    // unhandled rejection (the terminal is still restored and we still exit).
    void shutdown()
      .finally(finalize)
      .catch(() => {});
  };
}
