/**
 * Pure time-bucketing + chunking helpers shared by the storage write/read
 * path. No IO; unit-tested.
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
