/**
 * Human-readable elapsed time between a run's start and finish.
 *
 * Returns an em-dash placeholder while the run has not finished yet. Below a
 * second it reports raw milliseconds, below a minute a single-decimal seconds
 * value, and otherwise whole minutes. Shared by the run history list and the
 * run-detail hero so both surface the same figure.
 */
export function formatDuration(
  startedAt: Date | string,
  finishedAt: Date | string | null | undefined,
): string {
  if (!finishedAt) return "—";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}
