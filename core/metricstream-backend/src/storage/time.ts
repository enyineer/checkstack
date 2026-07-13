/**
 * Pure time-bucketing + chunking helpers shared by the storage write/read path.
 * No IO; unit-tested.
 */

/** Floor a timestamp to the start of its minute (UTC-safe; operates on epoch). */
export function floorToMinute(at: Date): Date {
  return new Date(Math.floor(at.getTime() / 60_000) * 60_000);
}

/** Floor a timestamp to the start of its hour. */
export function floorToHour(at: Date): Date {
  return new Date(Math.floor(at.getTime() / 3_600_000) * 3_600_000);
}

/** Split an array into chunks of at most `size` (size >= 1). */
export function chunk<T>({ items, size }: { items: T[]; size: number }): T[][] {
  if (size < 1) throw new Error("chunk size must be >= 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Max rows per multi-row insert/upsert statement (bounds statement size). */
export const STORAGE_CHUNK_SIZE = 500;

/** Max rows deleted per bounded retention batch (keeps a delete from locking long). */
export const RETENTION_DELETE_BATCH = 5000;

/**
 * The rollup boundary: minute buckets younger than this are still fine-grained
 * (not yet rolled up to hourly), so a read that wants recent detail hits the
 * minute tier and a read older than this hits the hourly tier.
 */
export function rollupBoundary({
  now,
  minuteRetentionHours,
}: {
  now: Date;
  minuteRetentionHours: number;
}): Date {
  return new Date(now.getTime() - minuteRetentionHours * 3_600_000);
}

/** A half-open `[from, to)` sub-window. */
export interface WindowRange {
  from: Date;
  to: Date;
}

/**
 * Split `[from, to)` at the rollup boundary into a COARSE part (older than the
 * boundary, served by the hourly tier) and a FINE part (at/after the boundary,
 * served by the minute tier). Either part is omitted when the window does not
 * reach into it. Pure.
 */
export function partitionWindowAtBoundary({
  from,
  to,
  boundary,
}: {
  from: Date;
  to: Date;
  boundary: Date;
}): { coarse?: WindowRange; fine?: WindowRange } {
  const result: { coarse?: WindowRange; fine?: WindowRange } = {};
  if (from < boundary) {
    result.coarse = {
      from,
      to: new Date(Math.min(to.getTime(), boundary.getTime())),
    };
  }
  if (to > boundary) {
    result.fine = {
      from: new Date(Math.max(from.getTime(), boundary.getTime())),
      to,
    };
  }
  return result;
}
