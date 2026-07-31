/**
 * The status IN EFFECT at each update of an event's history.
 *
 * The list arrives NEWEST FIRST - the order both `StatusUpdateTimeline` and the
 * public status-page widgets render in - so the status at update `i` is the one
 * set by the nearest status change at index `>= i`, the most recent change at
 * or before that moment. An update that changes nothing therefore keeps showing
 * where the event stood, instead of dropping its rail dot to a neutral grey
 * that is barely visible against the page.
 *
 * Never look the other way: taking the nearest change at a LOWER index would
 * back-fill a NEWER status, painting an update "resolved" while the incident
 * was in fact still being investigated when it was posted.
 *
 * Returns `undefined` for any entry OLDER than every status change in the
 * window. That is a real case, not a defensive branch: the public widget caps
 * how many updates it publishes, so the visible slice can begin part-way
 * through a history and genuinely not know what the status was back then. The
 * caller falls back to the event's own tone rather than inventing a lifecycle.
 *
 * Generic over the status type so a caller keeps its own union (an incident's
 * lifecycle, a maintenance's) instead of widening to `string`.
 */
export function resolveEffectiveStatuses<TStatus extends string>(
  statusChanges: ReadonlyArray<TStatus | undefined>
): Array<TStatus | undefined> {
  const effective: Array<TStatus | undefined> = Array.from({
    length: statusChanges.length,
  });
  let running: TStatus | undefined;
  // Oldest -> newest, so each entry inherits from the change that preceded it.
  for (let i = statusChanges.length - 1; i >= 0; i--) {
    running = statusChanges[i] ?? running;
    effective[i] = running;
  }
  return effective;
}
