/**
 * Is a check's most recent run old enough that its displayed status should no
 * longer be trusted?
 *
 * A health status is only as current as the run behind it. When runs stop
 * arriving - a satellite went offline, a worker is wedged, a schedule was
 * reconciled away - the last status stays on screen and silently ages into a
 * claim nobody is checking. Surfacing the age is what stops a dead probe from
 * reading exactly like a passing one.
 *
 * The thresholds match the overview's orphan detection (`overviewRows.logic`)
 * so the two never disagree about what "gone quiet" means.
 */

/** Missed intervals before a check is considered stale. */
export const STALE_MISSED_INTERVALS = 5;

/**
 * Floor on the silence window.
 *
 * A 10-second check would otherwise be called stale after 50 seconds, which is
 * within the noise of a slow tick or a brief queue backlog.
 */
export const STALE_MIN_SILENCE_MS = 10 * 60 * 1000;

/** The silence window for a check running on `intervalSeconds`. */
export function staleAfterMs({
  intervalSeconds,
}: {
  intervalSeconds: number;
}): number {
  return Math.max(
    intervalSeconds * 1000 * STALE_MISSED_INTERVALS,
    STALE_MIN_SILENCE_MS,
  );
}

export function isRunStale({
  lastRunAt,
  intervalSeconds,
  paused,
  orphaned,
  now,
}: {
  lastRunAt?: Date;
  intervalSeconds: number;
  /** A paused check is quiet ON PURPOSE, so it is never stale. */
  paused?: boolean;
  /**
   * A RETIRED slice: its environment was removed from the system or disabled
   * for this assignment, or its satellite was unassigned. It is quiet because
   * it is finished, not because anything is wrong.
   *
   * This is the difference between "nobody is checking this any more, and
   * someone should look" and "this correctly stopped". Warning about the second
   * is the classic false alarm - an operator who removes a satellite from an
   * assignment immediately gets a stale warning about the slice they just
   * retired on purpose, and learns to ignore the badge.
   */
  orphaned?: boolean;
  now: Date;
}): boolean {
  if (paused) return false;
  if (orphaned) return false;
  // A check that has NEVER run is not stale - it is new. The UI already
  // distinguishes that case with "Never", which is honest on its own.
  if (!lastRunAt) return false;

  return now.getTime() - lastRunAt.getTime() > staleAfterMs({ intervalSeconds });
}
