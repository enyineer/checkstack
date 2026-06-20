/**
 * Pure, DOM-free display helpers for the cache runtime panel.
 *
 * These derive the visual classification (status tone, urgency tier, bar
 * widths) shown by the runtime stat tiles and the entries table. They are kept
 * here so the branch logic can be unit-tested without rendering React or
 * importing `@checkstack/ui`. None of these helpers change the user-visible
 * text the panel emits; they only drive accent/tone styling.
 */

/** Urgency tier for an entry's TTL, driving the TTL cell's text tone. */
export type TtlTone = "down" | "warn" | "neutral";

/** Below this many seconds remaining, a TTL reads as about to lapse. */
export const TTL_WARN_THRESHOLD_SECONDS = 60;

/**
 * Classify how close an entry is to expiry for DISPLAY tinting only. Already
 * expired reads `"down"`, under a minute remaining `"warn"`, and everything
 * else (including no expiry) `"neutral"`. Computed from the same `expiresAt`
 * the panel's `formatTtl` consumes so tone and text agree.
 */
export function classifyTtlUrgency({
  expiresAt,
  now = Date.now(),
}: {
  expiresAt: Date | null | undefined;
  now?: number;
}): TtlTone {
  if (!expiresAt) return "neutral";
  const ms = expiresAt.getTime() - now;
  if (ms <= 0) return "down";
  if (ms <= TTL_WARN_THRESHOLD_SECONDS * 1000) return "warn";
  return "neutral";
}

/**
 * Proportional width (as a percentage in `[0, 100]`) of an entry's size bar
 * relative to the largest size in the current page. Returns `null` when the
 * entry has no measurable size or the page maximum is non-positive, so callers
 * render no bar. Small non-zero entries are floored to a faintly visible 2%.
 */
export function sizeBarWidthPercent({
  byteSize,
  maxByteSize,
}: {
  byteSize: number | null | undefined;
  maxByteSize: number;
}): number | null {
  if (byteSize === null || byteSize === undefined) return null;
  if (maxByteSize <= 0) return null;
  const ratio = byteSize / maxByteSize;
  const percent = Math.min(100, Math.max(0, ratio * 100));
  if (percent === 0) return 0;
  return Math.max(2, percent);
}

/**
 * Largest non-null `byteSize` across a page of entries, or `0` when none of
 * them report a size. Used as the denominator for {@link sizeBarWidthPercent}.
 */
export function maxByteSize({
  entries,
}: {
  entries: ReadonlyArray<{ byteSize: number | null | undefined }>;
}): number {
  let max = 0;
  for (const entry of entries) {
    if (
      entry.byteSize !== null &&
      entry.byteSize !== undefined &&
      entry.byteSize > max
    ) {
      max = entry.byteSize;
    }
  }
  return max;
}
