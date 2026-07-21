/**
 * Pure decisions behind the dashboard's linked-stream signal fillers, kept out
 * of the hook so they are directly unit-testable.
 *
 * Every stream plugin (logstream / metricstream / tracestream) reports its
 * linked streams' recent problems as dashboard signals via one bulk
 * `listLinkedStreamStatuses` call. Unlike the other dashboard signal sources
 * (health checks, incidents, SLOs, anomalies - all `userType: "public"`), that
 * procedure is `userType: "authenticated"`: observability data is never exposed
 * to anonymous visitors. The dashboard itself IS reachable anonymously (the
 * catalog read is public), so the filler must decide for itself whether the
 * call can succeed at all.
 */

/**
 * Whether the bulk linked-stream status lookup should run.
 *
 * - No systems in view: nothing to look up.
 * - Anonymous caller: the procedure is authenticated-only, so the request can
 *   only ever come back 401. Firing it anyway wasted a round-trip per stream
 *   plugin on every anonymous page load and made the backend log an
 *   "Authentication required" rejection for each one.
 *
 * `isAuthenticated` is false while the session is still resolving, which is the
 * behaviour we want: hold the request until the caller is known rather than
 * fire a doomed one.
 */
export function shouldFetchLinkedStreamStatuses({
  systemIdCount,
  isAuthenticated,
}: {
  systemIdCount: number;
  isAuthenticated: boolean;
}): boolean {
  return systemIdCount > 0 && isAuthenticated;
}

/**
 * Whether the filler should still report itself as loading to the dashboard.
 *
 * The dashboard holds its overview skeleton until every mounted signal source
 * has settled, so a source that is merely WAITING for the session to resolve
 * must not report "settled" - otherwise the overview renders "all healthy",
 * then flips back to a skeleton the moment the session lands and the real query
 * starts.
 */
export function isLinkedStreamSignalsLoading({
  queryLoading,
  authLoading,
}: {
  queryLoading: boolean;
  authLoading: boolean;
}): boolean {
  return queryLoading || authLoading;
}
