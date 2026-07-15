/**
 * Pure time-window math for the cursorless pull.
 *
 * A telemetry pull executor is handed NO persistent cursor by the platform, so
 * "emit only NEW events since the last pull" is approximated by a wall-clock
 * window: each run lists events and keeps those whose effective timestamp is
 * newer than `now - lookbackSeconds`. The tradeoff is inherent and documented on
 * `lookbackSeconds` in `schema.ts`: overlap between consecutive windows re-emits
 * events (duplicates), a window shorter than the pull interval drops them. There
 * is no upper bound on the window so an event timestamped slightly in the future
 * (clock skew) still emits.
 */

/** The exclusive lower bound of the window: `now - lookbackSeconds`. */
export function windowStart({
  now,
  lookbackSeconds,
}: {
  now: Date;
  lookbackSeconds: number;
}): Date {
  return new Date(now.getTime() - lookbackSeconds * 1000);
}

/**
 * Whether an event timestamp falls in the current window, i.e. strictly after
 * `windowStart`. The lower bound is EXCLUSIVE so an event sitting exactly on a
 * previous run's boundary is not re-emitted on the tick that lands on it.
 */
export function isWithinWindow({
  ts,
  now,
  lookbackSeconds,
}: {
  ts: Date;
  now: Date;
  lookbackSeconds: number;
}): boolean {
  return ts.getTime() > windowStart({ now, lookbackSeconds }).getTime();
}
