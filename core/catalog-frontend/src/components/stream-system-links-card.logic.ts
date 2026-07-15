/**
 * Pure set-equality for the stream-system-links draft, used by
 * {@link StreamSystemLinksSettingsCard} to decide whether the Save button is
 * enabled. Two link sets are "equal" when they contain the same system ids
 * regardless of order and regardless of duplicate ids - the picker never emits
 * duplicates, but comparing as sets keeps the check robust.
 */

/** True when both id lists contain exactly the same ids (order-insensitive). */
export function systemIdSetsEqual(
  a: readonly string[],
  b: readonly string[],
): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const id of setA) {
    if (!setB.has(id)) return false;
  }
  return true;
}

/**
 * True when the draft differs from the saved set and is therefore worth saving.
 * `saved` is undefined while the current links are still loading; a draft is
 * never dirty against unknown saved state (Save stays disabled until load).
 */
export function isLinksDraftDirty({
  draft,
  saved,
}: {
  draft: readonly string[];
  saved: readonly string[] | undefined;
}): boolean {
  if (saved === undefined) return false;
  return !systemIdSetsEqual(draft, saved);
}
