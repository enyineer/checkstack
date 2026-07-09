/**
 * Per-check status fingerprint — the change-signal that gates system-health
 * cache invalidation.
 *
 * The cached value is the full aggregated system-health response
 * (`getSystemHealthStatus`), but most of its fields are VOLATILE: every run
 * bumps `evaluatedAt`, a check's `lastRunAt`, and `runsConsidered` even when
 * nothing an operator sees actually changed. Invalidating on those would defeat
 * the cache (every tick evicts). The fingerprint is invariant to them: it
 * captures ONLY the derived-status vector a reader gates on:
 *  - the system-wide rollup `status`, and
 *  - per check: `configurationId`, its derived `status`, and its slice
 *    composition (`sliceCount` / `failingSliceCount`).
 *
 * So `statusVectorChanged(prev, next)` is true exactly when a check flipped
 * status, a slice began/stopped failing, or the check set changed — i.e. when a
 * status a reader renders actually moved. A run that merely refreshes timestamps
 * with the same vector is NOT a change, so the reconcile skips invalidation and
 * the cached value (correct except for volatile fields no reader needs) survives
 * to its TTL. This is the "broaden the change-signal to the per-check status
 * vector" requirement: it catches a per-check flip that leaves the rollup enum
 * unchanged (which the entity view's `{status, healthyChecks, totalChecks}`
 * would miss), while ignoring pure timestamp churn.
 */

/**
 * Structural subset of `SystemHealthStatusResponse` the fingerprint reads. The
 * service's response is assignable to this, so no import (and no cast) is needed
 * — keeping this module a leaf the cache and executor can both depend on.
 */
export interface StatusFingerprintInput {
  status: string;
  checkStatuses: readonly {
    configurationId: string;
    status: string;
    sliceCount: number;
    failingSliceCount: number;
  }[];
}

/**
 * A stable, order-independent fingerprint of a system-health response's derived
 * status vector. Checks are sorted by `configurationId` so two responses with
 * the same checks in a different order fingerprint identically.
 */
export function statusFingerprint(response: StatusFingerprintInput): string {
  const perCheck = response.checkStatuses
    .map(
      (c) =>
        `${c.configurationId}:${c.status}:${c.sliceCount}:${c.failingSliceCount}`,
    )
    .toSorted();
  return `${response.status}|${perCheck.join(",")}`;
}

/**
 * Whether the derived status vector changed between two responses (ignoring
 * volatile fields). This is the gate for cache invalidation + cross-pod
 * broadcast: only a real vector change evicts the cache and wakes other pods.
 */
export function statusVectorChanged(
  previous: StatusFingerprintInput,
  next: StatusFingerprintInput,
): boolean {
  return statusFingerprint(previous) !== statusFingerprint(next);
}
