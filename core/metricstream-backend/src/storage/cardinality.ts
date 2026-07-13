/**
 * Cardinality-cap partitioning. When a flush introduces series the stream has
 * never seen, admitting all of them could blow past the per-stream `seriesCap`.
 * This pure helper decides which NEW series to admit and which to DROP, given
 * how many series already exist and the cap. EXISTING series always keep
 * updating - only genuinely new series are subject to the cap.
 *
 * The admitted/dropped split is computed atomically (all inputs in hand) so the
 * flush transaction can insert only the admitted series and count the dropped
 * ones in ONE decision - no interleaving that could admit past the cap.
 *
 * BEST-EFFORT PER-POD-FLUSH SEMANTICS: `existingCount` is read once per flush
 * transaction, with NO cross-pod advisory lock on admission. When N pods flush
 * new series for the same stream concurrently, each sees a pre-write count and
 * can independently admit up to the headroom, so the live series total can
 * briefly OVERSHOOT `cap` by up to (concurrent-flushes x new-series-per-flush).
 * This is a deliberate trade to keep the hot ingest path lock-free; the overshoot
 * is BOUNDED and SELF-CORRECTING - the next flush observes the higher count and
 * admits fewer (or none), and retention later reclaims series that stop
 * reporting. Callers that need a hard ceiling must not rely on this helper alone.
 */

export interface CardinalityPartition<T> {
  /** New series to insert (fit within the remaining headroom). */
  admitted: T[];
  /** New series dropped because the cap is (or would be) exhausted. */
  dropped: T[];
}

/**
 * Partition candidate NEW series into admitted vs dropped.
 *
 * @param existingCount how many series already exist for the stream
 * @param cap the stream's `seriesCap`
 * @param candidates the new (not-yet-existing) series in this flush
 *
 * Headroom is `max(0, cap - existingCount)`. The first `headroom` candidates are
 * admitted (input order is the caller's responsibility - typically first-seen);
 * the rest are dropped. A non-positive headroom drops every candidate.
 */
export function partitionNewSeries<T>({
  existingCount,
  cap,
  candidates,
}: {
  existingCount: number;
  cap: number;
  candidates: T[];
}): CardinalityPartition<T> {
  const headroom = Math.max(0, cap - existingCount);
  if (headroom >= candidates.length) {
    return { admitted: candidates, dropped: [] };
  }
  return {
    admitted: candidates.slice(0, headroom),
    dropped: candidates.slice(headroom),
  };
}
