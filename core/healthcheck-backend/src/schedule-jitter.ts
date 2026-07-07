/**
 * Deterministic per-check scheduling jitter to de-cluster the health-check
 * "thundering herd".
 *
 * Many checks created together - or all overdue at once on a fresh boot - would
 * otherwise be scheduled with the same `startDelay` and identical intervals, so
 * they fire on the same phase forever: dozens of TCP/TLS handshakes contending
 * at the same instant, which inflates and destabilizes per-run connection setup
 * (the observed "same check, same site, wildly different durations"). Offsetting
 * each check's first fire by a stable fraction of its interval spreads them out;
 * because the queue anchors the recurrence to that first fire, the offset
 * persists for the schedule's whole life.
 *
 * The offset is DETERMINISTIC in the check's key (config + system), so a check
 * keeps the same slot across restarts instead of re-clustering on a fresh random
 * draw each boot.
 */

/** Default upper bound on the jitter window, in seconds. */
export const DEFAULT_JITTER_WINDOW_SECONDS = 30;

/**
 * A stable jitter offset in `[0, min(intervalSeconds, maxWindowSeconds))`
 * seconds, derived from `key`. Short intervals spread across the whole interval;
 * long intervals cap the window so a check still starts reasonably promptly.
 */
export function computeScheduleJitterSeconds({
  key,
  intervalSeconds,
  maxWindowSeconds = DEFAULT_JITTER_WINDOW_SECONDS,
}: {
  key: string;
  intervalSeconds: number;
  maxWindowSeconds?: number;
}): number {
  const window = Math.min(
    Math.max(0, Math.floor(intervalSeconds)),
    Math.max(0, Math.floor(maxWindowSeconds)),
  );
  if (window <= 0) return 0;

  // FNV-1a 32-bit hash of the key -> a stable fraction in [0, 1).
  let hash = 0x81_1C_9D_C5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.codePointAt(i) ?? 0;
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  const fraction = (hash >>> 0) / 0x1_00_00_00_00;
  return Math.floor(fraction * window);
}
